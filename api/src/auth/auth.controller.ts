import {
  Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, AssumeTenantDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

// Login rate-limit per IP — a coarse brute-force bound. Defaults to a STRICT 10/min. A test-only
// environment (staging, no real users) may relax it via AUTH_LOGIN_THROTTLE_LIMIT so the burst-heavy
// E2E smoke suite can run green; PROD leaves it unset → stays 10. ⚠️ NEVER set this on a real-user env.
const LOGIN_THROTTLE_LIMIT = Math.max(1, Number(process.env.AUTH_LOGIN_THROTTLE_LIMIT) || 10);

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Email + password login → rolling-session tokens (replaced phone + OTP, 2026-10-01).
   * Rate-limited per IP (default 10/min, env-overridable on a test env) as a coarse brute-force
   * bound; the service also locks an account after repeated failures.
   */
  @Public()
  @Throttle({ default: { limit: LOGIN_THROTTLE_LIMIT, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.clientId, dto.email, dto.password);
  }

  /** Refresh access token */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  /** Verify token is valid and return current user info */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user);
  }

  /**
   * POST /v1/auth/logout-all — self-service "log out from all devices".
   * Revokes every non-revoked session for the authenticated user.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  logoutAll(@CurrentUser() user: JwtPayload) {
    return this.authService.logoutAllSessions(user);
  }

  /**
   * POST /v1/auth/assume-tenant — GIFSY operator-context switcher.
   * @Roles is the coarse floor; the service re-asserts GIFSY_ADMIN + audit-logs.
   */
  @Roles('GIFSY_ADMIN')
  @Post('assume-tenant')
  @HttpCode(HttpStatus.OK)
  assumeTenant(@CurrentUser() user: JwtPayload, @Body() dto: AssumeTenantDto) {
    return this.authService.assumeTenant(user, dto.clientId);
  }
}
