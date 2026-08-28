import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SESSION_TTL_DAYS } from '../auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set. Refusing to start.');
    }
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      secret,
      // Pin the accepted signature algorithm to HS256 (the only alg we sign with). Without
      // this, jsonwebtoken accepts any HMAC alg the token declares — an attacker cannot forge
      // HS512 without the key, but pinning removes alg-confusion ambiguity as defense-in-depth.
      algorithms:       ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    // Bind the bearer token to its OWN session row via the `sid` claim (the UserSession PK),
    // so revoking/rotating that exact session invalidates this access token on its NEXT
    // request (instead of letting it live out its TTL). A token with no `sid` is not honored
    // (all tokens this chassis mints carry one).
    if (!payload.sid) {
      throw new UnauthorizedException('Session expired or revoked — please log in again.');
    }

    const session = await this.prisma.userSession.findFirst({
      where:   { id: payload.sid, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { isActive: true, sessionsInvalidBefore: true } } },
    });

    if (!session) {
      throw new UnauthorizedException('Session expired or revoked — please log in again.');
    }

    // ── Deactivated user (finding 5) ─────────────────────────────────────────────
    // Evict a deactivated user within the access-token TTL — a valid, unexpired access token
    // stops working on its NEXT request once the account is flipped inactive.
    if (!session.user.isActive) {
      throw new UnauthorizedException('Account deactivated — please contact your administrator.');
    }

    // ── logout-all / kill-switch authority (finding 4) ───────────────────────────
    // A "log out everywhere" / deactivation / reuse-detection stamps sessionsInvalidBefore; any
    // access token whose session was created before that stamp is dead on its next request, so
    // even a still-valid access token cannot outlive the kill by its full TTL.
    if (
      session.user.sessionsInvalidBefore &&
      session.createdAt < session.user.sessionsInvalidBefore
    ) {
      throw new UnauthorizedException('Session expired or revoked — please log in again.');
    }

    // ── Sliding session: roll expiresAt forward on activity (fire-and-forget) ────
    // A valid access re-mints the idle window to now + SESSION_TTL_DAYS. THROTTLED to
    // ≈once/day per session (only when the stored expiresAt has already decayed by >1 day)
    // to avoid a DB write on every request. Fire-and-forget: never awaited, never rejects
    // the request. Scoped to the live session; a revoked/expired session already 401'd above.
    const now = Date.now();
    const target = now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (session.expiresAt.getTime() < now + (SESSION_TTL_DAYS - 1) * 24 * 60 * 60 * 1000) {
      this.prisma.userSession
        .updateMany({
          where: { id: session.id, revokedAt: null, expiresAt: { lt: new Date(target) } },
          data:  { expiresAt: new Date(target), lastSeenAt: new Date() },
        })
        .catch(() => {});
    }

    return payload; // Becomes req.user
  }
}
