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
import { hashPassword } from '../common/password';

// SHA-256 hex — mirrors AuthService.hashToken, so a test can assert the atomic claim / revoke
// key on the HASH of a known plaintext refresh token (never the plaintext itself).
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ── Mocks ───────────────────────────────────────────────────────────────────────
const mockPrisma = {
  // user.findUnique: getMe + the refresh post-mint sessionsInvalidBefore re-read (defaults
  // undefined so the re-read is a no-op unless a test opts in).
  user:        { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
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
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  // ── login (email + password) ──────────────────────────────────────────────────
  describe('login', () => {
    const PW = 'correct-horse-battery';
    let hash: string;
    beforeAll(async () => { hash = await hashPassword(PW); });

    const activeUser = (over: Record<string, any> = {}) => ({
      id: 'u1', clientId: 'deoleo', email: 'asm@kwality.in', passwordHash: hash,
      failedLoginAttempts: 0, lockedUntil: null, role: 'ASM', name: 'ASM One',
      phone: null, vendorId: null, isActive: true, ...over,
    });

    beforeEach(() => {
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('rejects a missing tenant (400)', async () => {
      await expect(service.login('', 'asm@kwality.in', PW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unknown email → 401 (uniform, no enumeration) and does NOT mint a session', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.login('deoleo', 'nobody@kwality.in', PW)).rejects.toMatchObject({ status: 401 });
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('inactive user → 401', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ isActive: false }));
      await expect(service.login('deoleo', 'asm@kwality.in', PW)).rejects.toMatchObject({ status: 401 });
    });

    it('user with no password set → 401', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ passwordHash: null }));
      await expect(service.login('deoleo', 'asm@kwality.in', PW)).rejects.toMatchObject({ status: 401 });
    });

    it('wrong password → 401 and increments the failed-attempt counter', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ failedLoginAttempts: 1 }));
      await expect(service.login('deoleo', 'asm@kwality.in', 'wrong')).rejects.toMatchObject({ status: 401 });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: 2 }) }),
      );
    });

    it('wrong password at the cap → locks the account (lockedUntil set, counter reset)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ failedLoginAttempts: 4 })); // 5th fail
      await expect(service.login('deoleo', 'asm@kwality.in', 'wrong')).rejects.toMatchObject({ status: 401 });
      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.lockedUntil).toBeInstanceOf(Date);
      expect(data.failedLoginAttempts).toBe(0);
    });

    it('a currently-locked account → 403, without checking the password', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        activeUser({ lockedUntil: new Date(Date.now() + 10 * 60_000) }),
      );
      await expect(service.login('deoleo', 'asm@kwality.in', PW)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    });

    it('correct password → mints a session + returns the user (email), clears failed state', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ failedLoginAttempts: 2 }));
      const res = await service.login('deoleo', 'ASM@Kwality.in', PW); // case-insensitive email
      expect(res.accessToken).toBeTruthy();
      expect(res.refreshToken).toBeTruthy();
      expect(res.user).toMatchObject({ id: 'u1', email: 'asm@kwality.in', role: 'ASM' });
      expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
      // failed-attempt state reset on success
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failedLoginAttempts: 0, lockedUntil: null } }),
      );
    });

    it('a VENDOR_FIELD login with an inactive vendor → 403', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(activeUser({ role: 'VENDOR_FIELD', vendorId: 'v1' }));
      mockPrisma.vendor.findUnique.mockResolvedValue({ isActive: false });
      await expect(service.login('deoleo', 'asm@kwality.in', PW)).rejects.toBeInstanceOf(ForbiddenException);
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

    // ── FIX 1: ambiguous rotation must NOT nuke, but is no longer SILENT ─────────
    it('ambiguous rotation: replay >grace WITH a live successor → 401, NO lineage kill, but logs a security event', async () => {
      // Predecessor revoked 7s ago (outside the 5s grace) — but a LIVE successor descends from it.
      mockPrisma.userSession.findUnique.mockResolvedValue(liveSession({
        revokedAt: new Date(Date.now() - 7_000),
      }));
      mockPrisma.userSession.findFirst.mockResolvedValue({ id: 'succ' }); // live successor exists
      mockPrisma.auditLog.create.mockResolvedValue({});

      await expect(service.refreshToken('rt')).rejects.toThrow('Session expired');

      // The successor lookup keys on the lineage AND requires revokedAt:null.
      expect(mockPrisma.userSession.findFirst).toHaveBeenCalledWith({
        where:  { rotatedFromId: 'sess_x', revokedAt: null },
        select: { id: true },
      });
      // CRUCIAL: an active user is NOT logged out everywhere — no stamp, no revoke-all lineage kill.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
      // BUT the ambiguous reuse is no longer silent: a SECURITY_EVENT is recorded for monitoring.
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'SECURITY_EVENT',
            metadata: expect.objectContaining({ event: 'refresh_token_reuse_ambiguous' }),
          }),
        }),
      );
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

});
