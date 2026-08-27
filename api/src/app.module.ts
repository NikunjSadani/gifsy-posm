import { Module }                   from '@nestjs/common';
import { ConfigModule }             from '@nestjs/config';
import { isFixedOtpAllowed }        from './common/fixed-otp';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule }           from '@nestjs/schedule';
import { LoggerModule }             from 'nestjs-pino';
import { buildLoggerParams }        from './common/logging/logger.config';

import { AppController }  from './app.controller';
import { AppService }     from './app.service';
import { JwtAuthGuard }   from './common/guards/jwt-auth.guard';
import { RolesGuard }     from './common/guards/roles.guard';
import { TenantGuard }    from './common/guards/tenant.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter }  from './common/filters/all-exceptions.filter';

import { PrismaModule }        from './prisma/prisma.module';
import { StorageModule }       from './storage/storage.module';
import { TenantModule }        from './tenant/tenant.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule }          from './auth/auth.module';
import { CaptureModule }       from './capture/capture.module';

/**
 * Wave 0 CHASSIS — infra modules only. NO POSM domain modules (recce/install/audit/
 * vendor/site/masters) — those arrive in later waves. The global APP_GUARD chain
 * (Throttler → JwtAuth → Roles → Tenant → Permission), the response envelope interceptor,
 * and the exception filter are wired here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured logging — nestjs-pino. JSON to stdout in prod, pretty single-line in dev.
    LoggerModule.forRootAsync({ useFactory: buildLoggerParams }),
    // Background-jobs scaffold — domain cron jobs (report digests) are added per-wave.
    ScheduleModule.forRoot(),
    // Rate limiting — applied globally; OTP endpoints tighten it on the controller.
    ThrottlerModule.forRoot({
      throttlers: [{
        name:  'default',
        ttl:   60_000,  // 1 minute window (ms)
        limit: 60,
      }],
      // Skip ALL rate limiting when FIXED_OTP is honored (local dev + the E2E harness). Gated
      // by isFixedOtpAllowed (non-prod NODE_ENV / staging opt-in; never on the prod DB).
      skipIf: () => isFixedOtpAllowed() && !!process.env.FIXED_OTP,
    }),
    PrismaModule,
    StorageModule,
    TenantModule,
    NotificationsModule,
    AuthModule,
    CaptureModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Standard response envelope { success, data } / { success, error }.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
    // Rate limiter applied before auth so bots can't enumerate tokens.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JWT auth globally — use @Public() to opt out.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Tenant chokepoint (after JWT): asserts a tenant is resolved + stamps req.tenantId.
    { provide: APP_GUARD, useClass: TenantGuard },
    // RBAC permission enforcement — flag-gated, no-op unless @RequirePermission + flags on.
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
