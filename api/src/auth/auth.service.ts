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
import { generateNumericOtp, hashOtp } from '../common/otp';
import { normalizeIndianPhone } from '../common/phone';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
      // Match the User row by its canonical E.164 phone (users are stored normalized).
      const account = await this.prisma.user.findFirst({
        where: { phone: normalizeIndianPhone(cleanPhone), clientId, isActive: true },
        select: { id: true },
      });
      if (!account) {
        throw new UnauthorizedException(
          'No account found. Please contact your administrator to be onboarded first.',
        );
      }
    }

    const fixedOtpActive = isFixedOtpAllowed() && !!this.config.get<string>('FIXED_OTP');

    // Per-phone send cap over a rolling window (anti-SMS-bombing). Counted in the DB so it
    // holds across ALL Cloud Run instances — the controller's per-IP/@Throttle is per-instance
    // and a multi-instance distribution would bypass an in-memory cap. Skipped only under the
    // fixed-OTP bypass so UAT can request freely.
    const now = Date.now();
    const windowStart = new Date(now - OTP_RESEND_WINDOW_HOURS * 60 * 60 * 1000);
    if (!fixedOtpActive) {
      const recentSends = await this.prisma.otpCode.count({
        where: { phone: cleanPhone, purpose: 'LOGIN', createdAt: { gte: windowStart } },
      });
      if (recentSends >= OTP_MAX_RESENDS_PER_WINDOW) {
        this.logger.warn(`OTP send cap hit for ****${cleanPhone.slice(-4)}`);
        throw new HttpException(
          'Too many OTP requests for this number. Please wait a while before trying again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // (A small window-boundary race can let a couple extra through under high concurrency —
      // acceptable for an anti-abuse cap; each send still costs an SMS and the per-IP throttle
      // bounds the concurrent source.)
    }

    const otp = generateNumericOtp();
    const expiresAt = new Date(now + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Prune this phone's rows that have aged out of the send-cap window, then opportunistically
    // sweep globally-dead rows (>1 day past a 10-min expiry) so the table stays bounded without
    // a scheduler. In-window rows are RETAINED so the cap above counts real sends.
    await this.prisma.otpCode.deleteMany({
      where: { phone: cleanPhone, createdAt: { lt: windowStart } },
    });
    await this.prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } },
    });

    // Supersede: invalidate this phone's prior UNCONSUMED codes so only the freshest is live.
    // (verifyOtp also reads the NEWEST unconsumed row, so this is belt-and-suspenders — a
    // superseded code can never be verified.) Retains the rows for the send-cap count above.
    await this.prisma.otpCode.updateMany({
      where: { phone: cleanPhone, purpose: 'LOGIN', consumedAt: null },
      data:  { consumedAt: new Date(now) },
    });

    // Store only the HASH of the code — a DB read cannot recover a live OTP.
    await this.prisma.otpCode.create({
      data: {
        phone:       cleanPhone,
        clientId:    clientId ?? null,
        codeHash:    hashOtp(otp),
        purpose:     'LOGIN',
        channel,
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt,
      },
    });

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

    // Read the NEWEST unconsumed code for this phone (a fresh send supersedes older ones).
    const record = await this.prisma.otpCode.findFirst({
      where:   { phone: cleanPhone, purpose: 'LOGIN', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new UnauthorizedException('No active OTP found for this number. Please request a new OTP.');
    }
    if (record.attempts >= record.maxAttempts) {
      throw new ForbiddenException('Too many attempts — please request a new OTP.');
    }
    if (new Date() > record.expiresAt) {
      throw new UnauthorizedException('OTP expired — please request a new one.');
    }

    // FIXED_OTP is a dev/staging convenience bypass, gated by isFixedOtpAllowed. Otherwise the
    // submitted code is HASHED and compared to the stored hash (the plaintext is never stored).
    const fixedOtp = isFixedOtpAllowed() ? this.config.get<string>('FIXED_OTP') : undefined;
    const isCorrect = fixedOtp ? otp === fixedOtp : hashOtp(otp) === record.codeHash;

    if (!isCorrect) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data:  { attempts: record.attempts + 1 },
      });
      const remaining = record.maxAttempts - record.attempts - 1;
      throw new UnauthorizedException(
        `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      );
    }

    // Consume the OTP (mark used, so it cannot be replayed).
    await this.prisma.otpCode.update({
      where: { id: record.id },
      data:  { consumedAt: new Date() },
    });

    // Resolve the login user — the ACTIVE account IS the login (unique (clientId, phone)).
    // Match by canonical E.164 phone (users are stored normalized).
    const user = await this.prisma.user.findFirst({
      where: { phone: normalizeIndianPhone(cleanPhone), clientId, isActive: true },
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
      algorithm: 'HS256', // pinned both sides (verify: jwt.strategy algorithms:['HS256'])
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

    // ── Deactivated user (finding 5) ─────────────────────────────────────────────
    // A user deactivated mid-session cannot roll their session forward — hard-stop within the
    // access-token TTL. The atomic claim below already revoked live rows on the winning path,
    // but a deactivated user must be refused even before minting a successor.
    if (!session.user.isActive) {
      throw new UnauthorizedException('Session expired — please log in again.');
    }

    // ── logout-all / kill-switch authority — predecessor-predates-sweep guard (finding 4) ─────
    // If a "log out everywhere" / deactivation / reuse-detection stamped sessionsInvalidBefore
    // AFTER this session was created, the predecessor predates the sweep and is dead — refuse
    // regardless of the grace/reuse machinery below, so a session that existed at logout time
    // can never be rolled forward. (The DURING-refresh race is closed by the post-mint re-read.)
    if (
      session.user.sessionsInvalidBefore &&
      session.createdAt < session.user.sessionsInvalidBefore
    ) {
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
        const tokens = await this.generateTokens(session.user, { rotatedFromId: session.id });

        // ── kill-switch authority, DURING-refresh race (finding 4) ─────────────────────────
        // A concurrent "log out everywhere" (or reuse-detection) can land AFTER the predecessor
        // read but AROUND the successor create — the classic "successor survives the sweep" hole.
        // RE-READ the stamp now and compare it to the PREDECESSOR's createdAt. Note the two
        // timestamps have DIFFERENT clocks: predecessor.createdAt is DB-written (`now()`), while
        // sessionsInvalidBefore is stamped with the app clock (`new Date()`), so this is a
        // predecessor.createdAt (DB) vs app-written-stamp comparison — NOT two DB timestamps.
        // The guarantee still holds: a REAL predecessor is created long before any logout-all
        // (seconds-to-days earlier), so createdAt < stamp is decided by that large gap, and
        // sub-second app↔DB skew under NTP is negligible against it. Stampers write
        // sessionsInvalidBefore BEFORE revoking, so a sweep that missed our just-minted successor
        // is always preceded by a committed stamp this re-read observes → we revoke our own
        // successor and 401, leaving nothing live after logout-all.
        const fresh = await this.prisma.user.findUnique({
          where:  { id: session.user.id },
          select: { sessionsInvalidBefore: true },
        });
        if (fresh?.sessionsInvalidBefore && session.createdAt < fresh.sessionsInvalidBefore) {
          await this.prisma.userSession.updateMany({
            where: { refreshTokenHash: this.hashToken(tokens.refreshToken), revokedAt: null },
            data:  { revokedAt: new Date() },
          });
          throw new UnauthorizedException('Session expired — please log in again.');
        }

        return tokens;
      }
      // claim LOST: a concurrent winner revoked this row ~now — fall through.
    }

    // ── Revoked/expired predecessor ──────────────────────────────────────────────
    const predecessorRevokedAt = session.revokedAt ?? new Date();
    const withinGrace = Date.now() - predecessorRevokedAt.getTime() <= ROTATION_GRACE_MS;

    // Reuse detection: an ALREADY-REVOKED token replayed AFTER the grace window is a POSSIBLE
    // theft signal — but only when NO live token descends from it. A merely EXPIRED-but-never-
    // revoked session is NOT reuse.
    if (!withinGrace && session.revokedAt !== null) {
      // Distinguish TRUE reuse from a BENIGN stale rotation before nuking. A backgrounded PWA
      // tab (or an in-flight XHR that lost the atomic claim) can replay a token that was JUST
      // rotated: the winning refresh already minted a LIVE successor in this token's lineage.
      // Nuking on that false-positive would stamp sessionsInvalidBefore + revoke-all and log the
      // whole ACTIVE user out of every device — a real regression. So look for a live successor
      // FIRST, and treat the replay as theft ONLY when none exists.
      const liveSuccessor = await this.prisma.userSession.findFirst({
        where:  { rotatedFromId: session.id, revokedAt: null },
        select: { id: true },
      });

      // Benign rotation: a live successor exists → this is a legitimate concurrent/stale refresh,
      // not theft. Fall through to the 401 WITHOUT the lineage kill (no stamp, no revoke-all, no
      // audit) so the racing tab simply retries with the successor token it already holds.
      // (A replay whose DIRECT successor is ITSELF revoked is many rotation cycles stale — there
      // is no live token descending from THIS one — so it is still treated as reuse below.)
      if (!liveSuccessor) {
        const now = new Date();
        try {
          // TRUE reuse — no live descendant. STAMP sessionsInvalidBefore FIRST, then revoke
          // (stamp-before-revoke, finding 4) — the same authority logout-all uses, so any
          // in-flight refresh's post-mint re-read observes the stamp and drops its successor
          // rather than surviving the lineage kill. Best-effort; never masks the 401.
          await this.prisma.user.update({
            where: { id: session.userId },
            data:  { sessionsInvalidBefore: now },
          });
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
    }

    throw new UnauthorizedException('Session expired — please log in again.');
  }

  // ── Self-service "log out everywhere" ────────────────────────────────────────

  /** POST /v1/auth/logout-all — revoke ALL of the current user's non-revoked sessions. */
  async logoutAllSessions(user: JwtPayload): Promise<{ revoked: number }> {
    const revoked = await this.invalidateAllSessions(user.sub);

    await this.prisma.auditLog.create({
      data: {
        action: 'LOGOUT',
        entityType: 'SESSION',
        entityId: user.sub,
        actorId: user.sub,
        metadata: { event: 'logout_all_sessions', revoked },
      },
    });

    this.logger.log(`User ${user.sub} logged out of all sessions (${revoked} revoked)`);
    return { revoked };
  }

  /**
   * Reusable session kill-switch (finding 4) — STAMP `sessionsInvalidBefore = now` FIRST
   * (the authority), THEN revoke every live session. Stamp-before-revoke guarantees that a
   * concurrent refresh's post-mint re-read observes the stamp and drops its just-minted
   * successor, so nothing can outlive the kill. Call this from logout-all AND from user
   * deactivation (flip isActive=false, then invalidateAllSessions(userId)) so a deactivated
   * user is evicted from the refresh path immediately, not merely within the access-token TTL.
   * Returns the number of live sessions revoked.
   */
  async invalidateAllSessions(userId: string): Promise<number> {
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data:  { sessionsInvalidBefore: now },
    });
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: now },
    });
    return result.count;
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
}
