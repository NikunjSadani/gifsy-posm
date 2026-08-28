// Unit tests — AuthService (POSM auth chassis).
//
// Covers the money-path / session-security races that previously had no coverage:
//   OTP send-cap · supersede · attempt-cap · expiry · consume-on-success · hashed storage
//   refresh single-use atomic claim · revoked/expired → 401 · isActive gate
//   sessionsInvalidBefore (logout-all authority) up-front + post-mint re-read
//   reuse-detection: FIX-1 benign-rotation (live successor → 401, NO nuke) vs true reuse (nuke)
//   HS256 pinned.
//
// POSM specifics vs the loyalty original: refresh tokens are stored HASHED (SHA-256), the
// predecessor lookup is userSession.findUnique keyed on refreshTokenHash, the FIX-1 successor
// lookup is userSession.findFirst({ rotatedFromId, revokedAt:null }), and AuditLog has no
// targetUserId column. Roles are the POSM set (GIFSY_ADMIN / ASM / VENDOR_FIELD / …).
//
// Run: npx jest src/auth/auth.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Msg91Service } from '../notifications/msg91.service';
import { hashOtp } from '../common/otp';

// SHA-256 hex — mirrors AuthService.hashToken, so a test can assert the atomic claim / revoke
// key on the HASH of a known plaintext refresh token (never the plaintext itself).
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ── Mocks ───────────────────────────────────────────────────────────────────────
const mockPrisma = {
  // user.findUnique: getMe + the refresh post-mint sessionsInvalidBefore re-read (defaults
  // undefined so the re-read is a no-op unless a test opts in).
  user:        { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  otpCode:     { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
  // predecessor lookup is findUnique (keyed on refreshTokenHash); findFirst is the FIX-1
  // live-successor lookup (rotatedFromId, revokedAt:null).
  userSession: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  client:      { findUnique: jest.fn() },
  vendor:      { findUnique: jest.fn() },
  auditLog:    { create: jest.fn() },
};

const mockJwt = {
  sign:   jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
};

// FIXED_OTP unset → the real hash-compare path is exercised (fixedOtpActive stays false).
const mockConfig = {
  get: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      JWT_SECRET:     'test-secret',
      JWT_EXPIRES_IN: '60m',
    };
    return cfg[key];
  }),
};

const mockMsg91 = {
  sendOtp: jest.fn().mockResolvedValue({ requestId: null }),
};

const gifsyOp = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '98', name: 'Op' } as any;

// A live, unrevoked predecessor session (POSM shape: hashed refresh, user embedded).
const liveSession = (over: Record<string, any> = {}) => ({
  id: 'sess_x', userId: 'u1', refreshTokenHash: sha256('rt'), rotatedFromId: null,
  revokedAt: null,
  createdAt: new Date(Date.now() - 60_000),     // a minute ago — before any logout-all
  expiresAt: new Date(Date.now() + 3_600_000),
  user: { id: 'u1', role: 'ASM', clientId: 'deoleo', phone: '99', name: 'P', isActive: true, vendorId: null, sessionsInvalidBefore: null },
  ...over,
});

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService,    useValue: mockJwt    },
        { provide: ConfigService, useValue: mockConfig },
        { provide: Msg91Service,  useValue: mockMsg91  },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    // Restore the default config impl after clearAllMocks wiped it.
    mockConfig.get.mockImplementation((key: string) => {
      const cfg: Record<string, string> = { JWT_SECRET: 'test-secret', JWT_EXPIRES_IN: '60m' };
      return cfg[key];
    });
    mockJwt.sign.mockReturnValue('mock.jwt.token');
    mockMsg91.sendOtp.mockResolvedValue({ requestId: null });
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // ── sendOtp ─────────────────────────────────────────────────────────────────
  describe('sendOtp', () => {
    beforeEach(() => {
      mockPrisma.otpCode.count.mockResolvedValue(0);
      mockPrisma.otpCode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp_1' });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'seed-user' }); // registration gate: account exists
    });

    it('rejects an invalid phone (< 10 digits)', async () => {
      await expect(service.sendOtp('12345', 'SMS')).rejects.toThrow();
    });

    it('rejects (429) when the per-phone send cap over the window is reached', async () => {
      mockPrisma.otpCode.count.mockResolvedValue(5); // OTP_MAX_RESENDS_PER_WINDOW
      await expect(service.sendOtp('9876543210', 'SMS')).rejects.toMatchObject({ status: 429 });
      // Nothing created and no SMS sent once capped.
      expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
      expect(mockMsg91.sendOtp).not.toHaveBeenCalled();
    });

    it('counts only LOGIN sends inside the rolling window for the cap', async () => {
      await service.sendOtp('9876543210', 'SMS');
      const where = mockPrisma.otpCode.count.mock.calls[0][0].where;
      expect(where.phone).toBe('9876543210');
      expect(where.purpose).toBe('LOGIN');
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('SUPERSEDES prior unconsumed codes for the phone (only the freshest stays live)', async () => {
      await service.sendOtp('9876543210', 'SMS');
      // updateMany marks this phone's unconsumed LOGIN codes consumed.
      const call = mockPrisma.otpCode.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ phone: '9876543210', purpose: 'LOGIN', consumedAt: null });
      expect(call.data.consumedAt).toBeInstanceOf(Date);
    });

    it('stores the code HASHED (never the plaintext) — codeHash is a 64-char SHA-256 hex', async () => {
      await service.sendOtp('9876543210', 'SMS');
      const data = mockPrisma.otpCode.create.mock.calls[0][0].data;
      expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
      // The plaintext code is never persisted under any field.
      expect(data.code).toBeUndefined();
      // The stored value is a HASH of a 6-digit code, not a 6-digit code itself.
      expect(data.codeHash).not.toMatch(/^\d{6}$/);
      expect(mockMsg91.sendOtp).toHaveBeenCalled();
    });

    it('registration gate: refuses (401) a tenant-scoped send to a number with NO ACTIVE account', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // no active holder under the tenant
      await expect(service.sendOtp('9876543210', 'SMS', 'deoleo')).rejects.toMatchObject({ status: 401 });
      const where = mockPrisma.user.findFirst.mock.calls[0][0].where;
      // The User row is matched by canonical E.164 (users are stored normalized).
      expect(where).toMatchObject({ phone: '+919876543210', clientId: 'deoleo', isActive: true });
      expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
      expect(mockMsg91.sendOtp).not.toHaveBeenCalled();
    });

    it('registration gate: SKIPPED when no clientId is passed (unbranded caller)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // would reject IF the gate ran
      const res = await service.sendOtp('9876543210', 'SMS');
      expect(res.success).toBe(true);
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.otpCode.create).toHaveBeenCalled();
    });
  });

  // ── verifyOtp ───────────────────────────────────────────────────────────────
  describe('verifyOtp', () => {
    const phone = '9876543210';
    const clientId = 'deoleo';
    const code = '123456';
    const validOtp = () => ({
      id: 'otp_1', codeHash: hashOtp(code), attempts: 0, maxAttempts: 3,
      expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
    });

    it('returns access + refresh tokens on the correct (hash-matched) OTP', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user_1', role: 'ASM', clientId, phone, name: 'A', isActive: true, vendorId: null });
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });

      const result = await service.verifyOtp(phone, code, clientId);
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBeTruthy();
      expect(result.user).toMatchObject({ id: 'user_1', role: 'ASM' });
    });

    it('reads the NEWEST unconsumed code for the phone (supersede-aware)', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user_1', role: 'ASM', clientId, phone, name: 'A', isActive: true, vendorId: null });
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });

      await service.verifyOtp(phone, code, clientId);
      const call = mockPrisma.otpCode.findFirst.mock.calls[0][0];
      expect(call.where).toMatchObject({ phone, purpose: 'LOGIN', consumedAt: null });
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('CONSUMES the OTP on success (marks consumedAt so it cannot be replayed)', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user_1', role: 'ASM', clientId, phone, name: 'A', isActive: true, vendorId: null });
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });

      await service.verifyOtp(phone, code, clientId);
      const consumeCall = mockPrisma.otpCode.update.mock.calls.find(
        (c: any) => c[0]?.data?.consumedAt instanceof Date,
      );
      expect(consumeCall).toBeTruthy();
      expect(consumeCall[0].where).toEqual({ id: 'otp_1' });
    });

    it('throws on a wrong OTP and INCREMENTS attempts (attempt-cap accounting)', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      await expect(service.verifyOtp(phone, '000000', clientId)).rejects.toThrow('Invalid OTP');
      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attempts: 1 }) }),
      );
      // A wrong code never mints a session.
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('locks the OTP after the attempt cap is reached (attempts >= maxAttempts)', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({ ...validOtp(), attempts: 3 });
      await expect(service.verifyOtp(phone, code, clientId)).rejects.toThrow('Too many attempts');
      expect(mockPrisma.otpCode.update).not.toHaveBeenCalled();
    });

    it('throws on an expired OTP', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({ ...validOtp(), expiresAt: new Date(Date.now() - 1_000) });
      await expect(service.verifyOtp(phone, code, clientId)).rejects.toThrow('OTP expired');
    });

    it('throws when no unconsumed OTP exists for the phone', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(service.verifyOtp(phone, code, clientId)).rejects.toThrow();
    });

    it('throws "No account found" when the hash matches but no ACTIVE user resolves', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.verifyOtp(phone, code, clientId)).rejects.toThrow('No account found');
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('blocks a VENDOR login whose Vendor entity is inactive', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(validOtp());
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'v1', role: 'VENDOR_FIELD', clientId, phone, name: 'V', isActive: true, vendorId: 'ven1' });
      mockPrisma.vendor.findUnique.mockResolvedValue({ isActive: false });
      await expect(service.verifyOtp(phone, code, clientId)).rejects.toThrow('inactive');
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });
  });

  // ── generateTokens (HS256 pinning + session persistence) ──────────────────────
  describe('generateTokens', () => {
    it('pins the signing algorithm to HS256 and signs the expected payload', async () => {
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });
      await service.generateTokens({ id: 'user_1', role: 'ASM', clientId: 'deoleo', phone: '99', name: 'P' } as any);

      const [payload, opts] = mockJwt.sign.mock.calls[0];
      expect(payload).toMatchObject({ sub: 'user_1', role: 'ASM', clientId: 'deoleo' });
      expect(payload.sid).toBeTruthy();          // session-binding claim present
      expect(opts.algorithm).toBe('HS256');      // HS256 pinned on the sign side
    });

    it('persists the refresh token only as a HASH (never plaintext) on the session row', async () => {
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });
      const { refreshToken } = await service.generateTokens({ id: 'user_1', role: 'ASM', clientId: 'deoleo', phone: '99', name: 'P' } as any);
      const data = mockPrisma.userSession.create.mock.calls[0][0].data;
      expect(data.refreshTokenHash).toBe(sha256(refreshToken));
      expect(data.refreshTokenHash).not.toBe(refreshToken); // hash, not the raw token
    });
  });

  // ── refreshToken — single-use claim + reuse detection (FIX 1) ─────────────────
  describe('refreshToken', () => {
    it('claims the session ATOMICALLY (updateMany on refreshTokenHash+revokedAt:null) and mints exactly one successor', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession());
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 }); // claim wins
      mockPrisma.userSession.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({ sessionsInvalidBefore: null }); // post-mint re-read: clean

      const res = await service.refreshToken('rt');
      expect(res.accessToken).toBe('mock.jwt.token');
      // Atomic claim keyed on the HASH (not a read-then-update by id).
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { refreshTokenHash: sha256('rt'), revokedAt: null },
        data:  { revokedAt: expect.any(Date) },
      });
      // Exactly one successor, chaining rotatedFromId back to the predecessor.
      expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSession.create.mock.calls[0][0].data.rotatedFromId).toBe('sess_x');
    });

    it('unknown token → 401 (no session row)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(null);
      await expect(service.refreshToken('nope')).rejects.toThrow('Session expired');
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('a DEACTIVATED user cannot refresh → 401, never mints', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({ user: { ...liveSession().user, isActive: false } }));
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('sessionsInvalidBefore (logout-all authority) refuses a predecessor created before the stamp — up front, no mint', async () => {
      const s = liveSession({
        createdAt: new Date(Date.now() - 60_000),                                    // this session created…
        user: { ...liveSession().user, sessionsInvalidBefore: new Date(Date.now() - 1_000) }, // …before this stamp
      });
      mockPrisma.userSession.findUnique.mockResolvedValue(s);
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('a merely EXPIRED-but-never-revoked session → 401 and is NOT treated as reuse (no nuke)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({
        revokedAt: null, expiresAt: new Date(Date.now() - 1_000),
      }));
      // successor lookup would only run on the reuse branch (revokedAt !== null); guard it off.
      mockPrisma.userSession.findFirst.mockResolvedValue(null);
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();          // no stamp
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled(); // no revoke-all
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();       // no security event
    });

    // ── FIX 1: benign rotation must NOT nuke ────────────────────────────────────
    it('FIX-1 benign rotation: replay >grace WITH a live successor → 401, NO lineage kill', async () => {
      // Predecessor revoked 7s ago (outside the 5s grace) — but a LIVE successor descends from it.
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({
        revokedAt: new Date(Date.now() - 7_000),
      }));
      mockPrisma.userSession.findFirst.mockResolvedValue({ id: 'succ' }); // live successor exists

      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');

      // The successor lookup keys on the lineage AND requires revokedAt:null.
      expect(mockPrisma.userSession.findFirst).toHaveBeenCalledWith({
        where:  { rotatedFromId: 'sess_x', revokedAt: null },
        select: { id: true },
      });
      // CRUCIAL: an active user is NOT logged out everywhere — no stamp, no revoke-all, no audit.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    // ── FIX 1: true reuse (no live successor) still nukes ────────────────────────
    it('true reuse: replay >grace with NO live successor → 401 AND stamp-before-revoke lineage kill + audit', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({
        revokedAt: new Date(Date.now() - 7_000),
      }));
      mockPrisma.userSession.findFirst.mockResolvedValue(null); // NO live successor → theft signal
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');

      // STAMP the user (sessionsInvalidBefore) BEFORE revoking every live session.
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data:  { sessionsInvalidBefore: expect.any(Date) },
      });
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data:  { revokedAt: expect.any(Date) },
      });
      const stampOrder  = mockPrisma.user.update.mock.invocationCallOrder[0];
      const revokeOrder = mockPrisma.userSession.updateMany.mock.invocationCallOrder[0];
      expect(stampOrder).toBeLessThan(revokeOrder); // stamp-before-revoke
      // A single SECURITY_EVENT audit row (POSM AuditLog: entityId/actorId = userId, no targetUserId).
      const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'LOGOUT', entityType: 'SECURITY_EVENT', entityId: 'u1', actorId: 'u1' });
      expect(audit.metadata.event).toBe('refresh_token_reuse');
      expect(audit.metadata.sessionId).toBe('sess_x');
      // Never mints on the reuse path.
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('true reuse: a failed audit write does NOT mask the 401 (best-effort lineage kill)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({ revokedAt: new Date(Date.now() - 7_000) }));
      mockPrisma.userSession.findFirst.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('audit db down'));
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
    });

    it('in-grace loser (revoked < 5s ago, no live successor) → 401, NO nuke (transient collision)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({ revokedAt: new Date(Date.now() - 1_000) }));
      mockPrisma.userSession.findFirst.mockResolvedValue(null);
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
      // Inside grace → reuse block is skipped entirely.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    // ── post-mint re-read: logout-all landing DURING the refresh revokes the successor ──
    it('post-mint re-read: a logout-all stamp post-dating the predecessor revokes the just-minted successor → 401', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession()); // read BEFORE the stamp: clean
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });  // claim wins
      let mintedHash: string | undefined;
      mockPrisma.userSession.create.mockImplementation((arg: any) => {
        mintedHash = arg.data.refreshTokenHash; // capture the successor's stored hash
        return Promise.resolve({});
      });
      // Re-read observes a stamp created AFTER the predecessor (createdAt was a minute ago).
      mockPrisma.user.findUnique.mockResolvedValue({ sessionsInvalidBefore: new Date(Date.now() + 60_000) });

      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');

      // A successor WAS minted…
      expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
      // …then REVOKED: the LAST updateMany targets exactly that successor's hash.
      const calls = mockPrisma.userSession.updateMany.mock.calls;
      const last  = calls[calls.length - 1][0];
      expect(last.where).toMatchObject({ refreshTokenHash: mintedHash, revokedAt: null });
      expect(last.data.revokedAt).toBeInstanceOf(Date);
    });

    it('post-mint re-read: a clean stamp (null) lets the refresh succeed (re-read is a no-op)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession());
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userSession.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({ sessionsInvalidBefore: null });
      const res = await service.refreshToken('rt');
      expect(res.accessToken).toBe('mock.jwt.token');
    });

    it('lost claim (count 0) with no successor falls through to the revoked/expired handling → 401', async () => {
      // Our stale read shows revokedAt:null, but a concurrent winner revoked it → claim lost.
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession());
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 0 }); // claim lost
      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });
  });

  // ── logoutAllSessions ─────────────────────────────────────────────────────────
  describe('logoutAllSessions', () => {
    const caller = { sub: 'me1', role: 'ASM', clientId: 'deoleo', phone: '99', name: 'Me' } as any;

    it('stamps sessionsInvalidBefore AND revokes only the caller\'s live sessions, then audits', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await service.logoutAllSessions(caller);
      expect(res).toEqual({ revoked: 3 });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'me1' },
        data:  { sessionsInvalidBefore: expect.any(Date) },
      });
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'me1', revokedAt: null },
        data:  { revokedAt: expect.any(Date) },
      });
      // stamp-before-revoke authority.
      expect(mockPrisma.user.update.mock.invocationCallOrder[0])
        .toBeLessThan(mockPrisma.userSession.updateMany.mock.invocationCallOrder[0]);
      const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'LOGOUT', actorId: 'me1' });
      expect(audit.metadata).toMatchObject({ event: 'logout_all_sessions', revoked: 3 });
    });
  });

  // ── assumeTenant (operator-context switcher) ──────────────────────────────────
  describe('assumeTenant', () => {
    beforeEach(() => {
      mockPrisma.client.findUnique.mockResolvedValue({ id: 'deoleo', name: 'Deoleo' });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '98', name: 'Op', vendorId: null });
      mockPrisma.userSession.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('mints a token pinned to the target tenant, keeping the GIFSY role + real operator sub + assumed flag', async () => {
      const res = await service.assumeTenant(gifsyOp, 'deoleo');
      expect(res.clientId).toBe('deoleo');
      expect(res.brandName).toBe('Deoleo');
      const payload = mockJwt.sign.mock.calls[0][0];
      expect(payload).toMatchObject({ sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'deoleo', assumed: true });
    });

    it('refuses a non-GIFSY caller (403) and writes no audit', async () => {
      const clientAdmin = { ...gifsyOp, role: 'CLIENT_ADMIN', clientId: 'deoleo' };
      await expect(service.assumeTenant(clientAdmin, 'other')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('400s assuming the operator\'s own context', async () => {
      await expect(service.assumeTenant(gifsyOp, 'gifsy')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s an unknown tenant', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.assumeTenant(gifsyOp, 'no-such')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── FIXED_OTP bypass (dev/staging only) ───────────────────────────────────────
  describe('FIXED_OTP mode', () => {
    it('accepts the fixed OTP regardless of the stored hash when FIXED_OTP is honored', async () => {
      mockConfig.get.mockImplementation((key: string): any => key === 'FIXED_OTP' ? '123456' : (key === 'JWT_SECRET' ? 'test-secret' : undefined));
      // Stored hash is for a DIFFERENT code; FIXED_OTP must still let '123456' through.
      mockPrisma.otpCode.findFirst.mockResolvedValue({ id: 'otp_1', codeHash: hashOtp('999999'), attempts: 0, maxAttempts: 3, expiresAt: new Date(Date.now() + 60_000), consumedAt: null });
      mockPrisma.otpCode.update.mockResolvedValue({});
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user_1', role: 'ASM', clientId: 'deoleo', phone: '9876543210', name: 'A', isActive: true, vendorId: null });
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });

      const res = await service.verifyOtp('9876543210', '123456', 'deoleo');
      expect(res.accessToken).toBe('mock.jwt.token');
    });

    it('REFUSES to honor FIXED_OTP under NODE_ENV=production (falls back to the stored hash)', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        mockConfig.get.mockImplementation((key: string): any => key === 'FIXED_OTP' ? '123456' : (key === 'JWT_SECRET' ? 'test-secret' : undefined));
        mockPrisma.otpCode.findFirst.mockResolvedValue({ id: 'otp_1', codeHash: hashOtp('999999'), attempts: 0, maxAttempts: 3, expiresAt: new Date(Date.now() + 60_000), consumedAt: null });
        mockPrisma.otpCode.update.mockResolvedValue({});
        await expect(service.verifyOtp('9876543210', '123456', 'deoleo')).rejects.toThrow('Invalid OTP');
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });
});
