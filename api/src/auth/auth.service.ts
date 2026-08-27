import {
  Injectable, UnauthorizedException, BadRequestException,
  Logger, ForbiddenException, NotFoundException,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { Msg91Service } from '../notifications/msg91.service';
import { isFixedOtpAllowed } from '../common/fixed-otp';
import { generateNumericOtp } from '../common/otp';
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_WINDOW_HOURS,
  OTP_MAX_RESENDS_PER_WINDOW,
  SESSION_TTL_DAYS,
  ACCESS_TTL,
} from './auth.constants';
import * as crypto from 'crypto';

/**
 * Idempotent-rotation grace window (ms). A refresh token that has JUST been rotated by a
 * concurrent tab is treated as a benign concurrent refresh (→ 401 + must retry) rather than
 * theft while within this window; outside it, replay of an already-revoked token trips
 * reuse detection. Kept short so the reuse-detection window stays tight.
 */
const ROTATION_GRACE_MS = 5_000;

/**
 * One issued OTP, held in memory (the POSM schema intentionally has NO OtpCode table — the
 * chassis keeps OTP state process-local). Keyed by phone. See the CHASSIS decision note in
 * docs/plans/POSM-BUILD-PLAN.md: durable/multi-instance OTP persistence is a later-wave call.
 */
interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
  sends: number[]; // send timestamps within the rolling anti-abuse window
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * In-memory OTP store. Per-instance (not shared across Cloud Run instances) — acceptable
   * for the chassis; a durable store is a domain-wave decision. Pruned opportunistically.
   */
  private readonly otpStore = new Map<string, OtpRecord>();

  constructor(
    private readonly prisma:  PrismaService,
    private readonly jwt:     JwtService,
    private readonly config:  ConfigService,
    private readonly msg91:   Msg91Service,
  ) {}

  // ── Current user ──────────────────────────────────────────────────────────────

  /** GET /v1/auth/me — the POSM-minimal identity ({id,name,role,clientId,vendorId?}). */
  async getMe(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { name: true, role: true, clientId: true, vendorId: true },
    });
    return {
      id: user.sub,
      name: dbUser?.name ?? user.name,
      role: dbUser?.role ?? user.role,
      clientId: user.clientId,
      vendorId: dbUser?.vendorId ?? user.vendorId ?? null,
      assumed: user.assumed ?? false,
    };
  }

  // ── Send OTP ────────────────────────────────────────────────────────────────

  async sendOtp(
    phone: string,
    channel: 'SMS' | 'WHATSAPP',
    clientId?: string,
  ): Promise<{ success: boolean; expiresIn: number }> {
    if (!phone || phone.replace(/\D/g, '').length !== 10) {
      throw new BadRequestException('Invalid phone number — must be 10 digits');
    }
    const cleanPhone = phone.replace(/\D/g, '');

    // Registration gate: for a tenant-scoped login, refuse to send an OTP to a number that has
    // no ACTIVE account under this tenant — immediate "no account" feedback. Skipped when
    // clientId is absent (unbranded caller). Runs even under the FIXED_OTP bypass so it is
    // testable on staging.
    if (clientId) {
      const account = await this.prisma.user.findFirst({
        where: { phone: cleanPhone, clientId, isActive: true },
        select: { id: true },
      });
      if (!account) {
        throw new UnauthorizedException(
          'No account found. Please contact your administrator to be onboarded first.',
        );
      }
    }

    const fixedOtpActive = isFixedOtpAllowed() && !!this.config.get<string>('FIXED_OTP');

    // Per-phone send cap over a rolling window (anti-SMS-bombing). Skipped under the fixed-OTP
    // bypass so UAT can request freely.
    const now = Date.now();
    const windowStart = now - OTP_RESEND_WINDOW_HOURS * 60 * 60 * 1000;
    const existing = this.otpStore.get(cleanPhone);
    const recentSends = (existing?.sends ?? []).filter((t) => t >= windowStart);
    if (!fixedOtpActive && recentSends.length >= OTP_MAX_RESENDS_PER_WINDOW) {
      this.logger.warn(`OTP send cap hit for ****${cleanPhone.slice(-4)}`);
      throw new HttpException(
        'Too many OTP requests for this number. Please wait a while before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = generateNumericOtp();
    this.otpStore.set(cleanPhone, {
      code: otp,
      expiresAt: now + OTP_EXPIRY_MINUTES * 60 * 1000,
      attempts: 0,
      sends: [...recentSends, now],
    });
    this.pruneOtpStore();

    // Per-tenant template resolution is a later-wave concern; pass undefined (global template).
    await this.msg91.sendOtp(cleanPhone, otp, channel);

    this.logger.log(`OTP sent to ****${cleanPhone.slice(-4)} via ${channel}`);
    return { success: true, expiresIn: OTP_EXPIRY_MINUTES * 60 };
  }

  // ── Verify OTP + issue tokens ────────────────────────────────────────────────

  async verifyOtp(
    phone: string,
    otp: string,
    clientId: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: Partial<User> }> {
    const cleanPhone = phone.replace(/\D/g, '');
    const record = this.otpStore.get(cleanPhone);

    if (!record) {
      throw new UnauthorizedException('No active OTP found for this number. Please request a new OTP.');
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      this.otpStore.delete(cleanPhone);
      throw new ForbiddenException('Too many attempts — please request a new OTP.');
    }
    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanPhone);
      throw new UnauthorizedException('OTP expired — please request a new one.');
    }

    // FIXED_OTP is a dev/staging convenience bypass, gated by isFixedOtpAllowed.
    const fixedOtp = isFixedOtpAllowed() ? this.config.get<string>('FIXED_OTP') : undefined;
    const isCorrect = fixedOtp ? otp === fixedOtp : otp === record.code;

    if (!isCorrect) {
      record.attempts += 1;
      const remaining = OTP_MAX_ATTEMPTS - record.attempts;
      throw new UnauthorizedException(
        `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      );
    }

    // Consume the OTP.
    this.otpStore.delete(cleanPhone);

    // Resolve the login user — the ACTIVE account IS the login (unique (clientId, phone)).
    const user = await this.prisma.user.findFirst({
      where: { phone: cleanPhone, clientId, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException(
        'No account found. Please contact your administrator to be onboarded first.',
      );
    }

    // VENDOR login gate — a vendor login is blocked when its Vendor entity is inactive.
    await this.assertVendorLoginAllowed(user);

    const tokens = await this.generateTokens(user);
    this.logger.log(`User ${user.id} (${user.role}) logged in — client: ${clientId}`);

    return {
      ...tokens,
      user: { id: user.id, name: user.name, role: user.role, phone: user.phone },
    };
  }

  // ── Generate JWT + Refresh token ─────────────────────────────────────────────

  /**
   * Mint an access + refresh token and persist a session row. The refresh token is returned
   * to the client in PLAINTEXT but stored only as a SHA-256 hash (UserSession.refreshTokenHash),
   * so a DB read cannot recover a usable refresh token.
   *
   * `opts.clientIdOverride` / `opts.assumed` support the operator-context (assume-tenant) flow.
   */
  async generateTokens(
    user: User,
    opts?: { clientIdOverride?: string; assumed?: boolean; expiresIn?: string; rotatedFromId?: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const clientId = opts?.clientIdOverride ?? user.clientId;
    // Pre-generate the session id so it can be embedded in the JWT (`sid`) AND used as the
    // UserSession PK — jwt.strategy binds the bearer token to THIS session.
    const sid = crypto.randomUUID();
    const payload = {
      sub:      user.id,
      role:     user.role,
      clientId,
      phone:    user.phone,
      name:     user.name,
      sid,
      ...(opts?.assumed ? { assumed: true } : {}),
      ...(user.vendorId ? { vendorId: user.vendorId } : {}),
    };

    const expiresIn = (opts?.expiresIn ?? this.config.get('JWT_EXPIRES_IN') ?? ACCESS_TTL) as string;
    const accessToken = this.jwt.sign(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: expiresIn as unknown as number,
    });

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = this.hashToken(refreshToken);
    const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000; // 7 days
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.prisma.userSession.create({
      data: {
        id:               sid,
        userId:           user.id,
        refreshTokenHash,
        expiresAt,
        ...(opts?.rotatedFromId ? { rotatedFromId: opts.rotatedFromId } : {}),
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * POST /v1/auth/assume-tenant — operator-context switcher.
   *
   * A GIFSY_ADMIN exchanges their session for one scoped to ONE tenant's context, so per-brand
   * operations run under the normal `clientId` discipline. `sub` stays the real operator (audit).
   *
   * CHASSIS NOTE: the POSM UserSession row does not persist the assumed clientId, so an assumed
   * session reverts to the operator's home scope on its next refresh (~hourly). Acceptable for
   * the chassis; a domain wave that needs durable assumed sessions would add a session column.
   */
  async assumeTenant(
    operator: JwtPayload,
    targetClientId: string,
  ): Promise<{ accessToken: string; refreshToken: string; clientId: string; brandName: string }> {
    if (operator.role !== 'GIFSY_ADMIN') {
      throw new ForbiddenException('Only Gifsy operators may switch brand context');
    }
    if (targetClientId === operator.clientId) {
      throw new BadRequestException('Already in this context');
    }

    const target = await this.prisma.client.findUnique({
      where: { id: targetClientId },
      select: { id: true, name: true },
    });
    if (!target) {
      throw new NotFoundException('Tenant not found');
    }

    const opUser = await this.prisma.user.findFirst({ where: { id: operator.sub } });
    if (!opUser) throw new UnauthorizedException('Operator account not found');

    await this.prisma.auditLog.create({
      data: {
        action: 'LOGIN',
        entityType: 'CLIENT',
        entityId: targetClientId,
        actorId: operator.sub,
        metadata: { event: 'ASSUME_TENANT', fromClientId: operator.clientId, toClientId: targetClientId },
      },
    });

    const tokens = await this.generateTokens(opUser, {
      clientIdOverride: targetClientId,
      assumed: true,
      expiresIn: ACCESS_TTL,
    });

    this.logger.log(`GIFSY operator ${operator.sub} assumed tenant ${targetClientId}`);
    return { ...tokens, clientId: targetClientId, brandName: target.name };
  }

  // ── Refresh token ────────────────────────────────────────────────────────────

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = this.hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where:   { refreshTokenHash: hash },
      include: { user: true },
    });

    // Unknown token → 401 (genuine bad/forged token).
    if (!session) {
      throw new UnauthorizedException('Session expired — please log in again.');
    }

    // ── Live path: unrevoked and unexpired ───────────────────────────────────────
    if (session.revokedAt === null && new Date() <= session.expiresAt) {
      // ATOMIC single-use claim: revoke THIS row in one statement; only the winner proceeds.
      const claim = await this.prisma.userSession.updateMany({
        where: { refreshTokenHash: hash, revokedAt: null },
        data:  { revokedAt: new Date() },
      });

      if (claim.count === 1) {
        // Re-apply the vendor login gate on every refresh — a vendor deactivated mid-session
        // loses the ability to roll their session forward.
        await this.assertVendorLoginAllowed(session.user);

        // Mint the successor, chaining rotatedFromId back to THIS predecessor.
        // CHASSIS NOTE: assumed scope is not preserved (no clientId column on the session).
        return this.generateTokens(session.user, { rotatedFromId: session.id });
      }
      // claim LOST: a concurrent winner revoked this row ~now — fall through.
    }

    // ── Revoked/expired predecessor ──────────────────────────────────────────────
    const predecessorRevokedAt = session.revokedAt ?? new Date();
    const withinGrace = Date.now() - predecessorRevokedAt.getTime() <= ROTATION_GRACE_MS;

    // Reuse detection: an ALREADY-REVOKED token replayed AFTER the grace window (with no live
    // successor to converge on) is a strong theft signal — revoke every live session for the
    // user. A merely EXPIRED-but-never-revoked session is NOT reuse. Best-effort; never masks
    // the 401. (The chassis stores only refresh HASHES, so a benign concurrent refresh cannot
    // be handed the sibling's plaintext token — it simply retries.)
    if (!withinGrace && session.revokedAt !== null) {
      const now = new Date();
      try {
        await this.prisma.userSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data:  { revokedAt: now },
        });
        await this.prisma.auditLog.create({
          data: {
            action: 'LOGOUT',
            entityType: 'SECURITY_EVENT',
            entityId: session.userId,
            actorId: session.userId,
            metadata: { event: 'refresh_token_reuse', sessionId: session.id, detectedAt: now.toISOString() },
          },
        });
      } catch {
        /* best-effort lineage kill — never mask the 401 below */
      }
      this.logger.warn(`Refresh-token reuse detected for user ${session.userId} — revoked all sessions`);
    }

    throw new UnauthorizedException('Session expired — please log in again.');
  }

  // ── Self-service "log out everywhere" ────────────────────────────────────────

  /** POST /v1/auth/logout-all — revoke ALL of the current user's non-revoked sessions. */
  async logoutAllSessions(user: JwtPayload): Promise<{ revoked: number }> {
    const now = new Date();
    const result = await this.prisma.userSession.updateMany({
      where: { userId: user.sub, revokedAt: null },
      data:  { revokedAt: now },
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'LOGOUT',
        entityType: 'SESSION',
        entityId: user.sub,
        actorId: user.sub,
        metadata: { event: 'logout_all_sessions', revoked: result.count },
      },
    });

    this.logger.log(`User ${user.sub} logged out of all sessions (${result.count} revoked)`);
    return { revoked: result.count };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** SHA-256 hex of a refresh token — the only form persisted (UserSession.refreshTokenHash). */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Block a vendor login whose Vendor entity is inactive. A non-vendor user is a no-op; a
   * VENDOR_* user with no vendorId is refused (misconfigured login).
   */
  private async assertVendorLoginAllowed(user: {
    role: string;
    vendorId: string | null;
  }): Promise<void> {
    if (user.role !== 'VENDOR_FIELD' && user.role !== 'VENDOR_HO') return;
    if (!user.vendorId) {
      throw new ForbiddenException('This vendor login is not linked to a vendor. Contact support.');
    }
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: user.vendorId },
      select: { isActive: true },
    });
    if (!vendor || !vendor.isActive) {
      throw new ForbiddenException('This vendor account is inactive. Please contact support.');
    }
  }

  /** Drop expired OTP records so the in-memory store stays bounded. */
  private pruneOtpStore(): void {
    const now = Date.now();
    for (const [phone, rec] of this.otpStore) {
      if (rec.expiresAt < now) this.otpStore.delete(phone);
    }
  }
}
