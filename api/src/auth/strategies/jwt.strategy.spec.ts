// Unit tests — JwtStrategy (POSM auth chassis).
//
// Covers the access-token gate: HS256 secret bootstrap, session-binding via `sid`, the
// live-session lookup, the isActive eviction, the sessionsInvalidBefore (logout-all authority)
// gate, and the fire-and-forget sliding-session bump.
//
// POSM specifics: the constructor takes (config, prisma) only (no ActivityService), and the
// session lookup embeds user.{isActive, sessionsInvalidBefore}.
//
// Run: npx jest src/auth/strategies/jwt.strategy.spec.ts

import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const DAY_MS = 24 * 60 * 60 * 1000;

const mockPrisma = {
  userSession: {
    findFirst: jest.fn(),
    // fire-and-forget slide bump — default to a resolved thenable so `.catch(...)` attaches.
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

const makeConfig = (secret: string | undefined) => ({ get: jest.fn().mockReturnValue(secret) }) as any;

// A live session row as returned by the lookup (createdAt long before any stamp; fresh expiry
// so the slide guard is a no-op unless a test overrides expiresAt).
const liveSession = (over: Record<string, any> = {}) => ({
  id: 'sess_1',
  createdAt: new Date(Date.now() - 60_000),
  expiresAt: new Date(Date.now() + 7 * DAY_MS),
  user: { isActive: true, sessionsInvalidBefore: null },
  ...over,
});

const payload = () => ({ sub: 'user_1', role: 'ASM', clientId: 'deoleo', phone: '9876543210', name: 'T', sid: 'sess_1' });

describe('JwtStrategy', () => {
  describe('constructor', () => {
    it('throws at startup when JWT_SECRET is not set', () => {
      expect(() => new JwtStrategy(makeConfig(undefined), mockPrisma as any))
        .toThrow('JWT_SECRET environment variable is not set');
    });

    it('constructs successfully when JWT_SECRET is present', () => {
      expect(() => new JwtStrategy(makeConfig('supersecret'), mockPrisma as any)).not.toThrow();
    });
  });

  describe('validate', () => {
    let strategy: JwtStrategy;

    beforeEach(() => {
      strategy = new JwtStrategy(makeConfig('supersecret'), mockPrisma as any);
      jest.clearAllMocks();
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    });

    it('returns the payload when a live session bound by sid exists', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession());
      const p = payload();
      await expect(strategy.validate(p as any)).resolves.toEqual(p);
      // The lookup binds to the sid AND requires unrevoked + unexpired.
      const where = mockPrisma.userSession.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe('sess_1');
      expect(where.revokedAt).toBeNull();
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it('rejects a token with NO sid claim (unbound) → 401', async () => {
      const p = { ...payload(), sid: undefined };
      await expect(strategy.validate(p as any)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.userSession.findFirst).not.toHaveBeenCalled();
    });

    it('throws 401 when the session is revoked/expired (no matching row)', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(null);
      await expect(strategy.validate(payload() as any)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
    });

    it('evicts a DEACTIVATED user (isActive:false) within the access-token TTL → 401', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({ user: { isActive: false, sessionsInvalidBefore: null } }));
      await expect(strategy.validate(payload() as any)).rejects.toThrow('Account deactivated');
    });

    it('enforces sessionsInvalidBefore: a session created before the stamp is dead → 401', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({
        createdAt: new Date(Date.now() - 60_000),               // created a minute ago…
        user: { isActive: true, sessionsInvalidBefore: new Date(Date.now() - 1_000) }, // …stamped after
      }));
      await expect(strategy.validate(payload() as any)).rejects.toThrow(UnauthorizedException);
    });

    it('a session created AFTER the stamp survives (fresh login post-logout-all)', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({
        createdAt: new Date(Date.now() - 1_000),                                       // just created…
        user: { isActive: true, sessionsInvalidBefore: new Date(Date.now() - 60_000) }, // …stamp is older
      }));
      const p = payload();
      await expect(strategy.validate(p as any)).resolves.toEqual(p);
    });

    // ── sliding-session bump ────────────────────────────────────────────────────
    it('slides expiresAt to ≈ now + 7d when the session has decayed by > 1 day', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({ expiresAt: new Date(Date.now() + 2 * DAY_MS) }));
      await strategy.validate(payload() as any);
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.userSession.updateMany.mock.calls[0][0];
      expect(arg.where).toMatchObject({ id: 'sess_1', revokedAt: null });
      const target: Date = arg.data.expiresAt;
      expect(target.getTime()).toBeGreaterThanOrEqual(Date.now() + 7 * DAY_MS - 2000);
      expect(target.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS + 2000);
    });

    it('does NOT slide a still-fresh session (decayed < 1 day)', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({ expiresAt: new Date(Date.now() + 6.5 * DAY_MS) }));
      await strategy.validate(payload() as any);
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
    });

    it('the slide is fire-and-forget — a rejected updateMany never fails validate', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(liveSession({ expiresAt: new Date(Date.now() + 2 * DAY_MS) }));
      mockPrisma.userSession.updateMany.mockRejectedValueOnce(new Error('db down'));
      const p = payload();
      await expect(strategy.validate(p as any)).resolves.toEqual(p);
    });
  });
});
