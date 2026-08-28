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

// Wave 1 — domain masters + ingestion
import { VendorsModule }       from './vendors/vendors.module';
import { UsersModule }         from './users/users.module';
import { PosmTypesModule }     from './posm-types/posm-types.module';
import { SitesModule }         from './sites/sites.module';

// Wave 2 — recce → approval → installation → audit pipeline + media view
import { CaptureIntegrityModule } from './capture-integrity/capture-integrity.module';
import { RecceModule }        from './recce/recce.module';
import { InstallationModule } from './installation/installation.module';
import { ApprovalModule }     from './approval/approval.module';
import { AuditReviewModule }  from './audit-review/audit-review.module';
import { MediaModule }        from './media/media.module';

// Manual workflow — ad-hoc admin-defined task pipeline (separate from recce→install)
import { ManualModule }       from './manual/manual.module';

// Analytics — read-only reporting over the pipeline (admin dashboard + Vendor-HO console)
import { AnalyticsModule }    from './analytics/analytics.module';

// Reports — per-tenant automated email digest (config + preview + send) + hourly cron
import { ReportsModule }      from './reports/reports.module';

/**
 * Chassis (Wave 0) + domain masters (Wave 1) + the field pipeline (Wave 2: recce → ASM
 * approval → installation → auditor review, capture integrity, media view). The global APP_GUARD chain
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

    // Wave 1 — domain masters + ingestion
    VendorsModule,
    UsersModule,
    PosmTypesModule,
    SitesModule,

    // Wave 2 — recce → approval → installation → audit pipeline + media view
    CaptureIntegrityModule,
    RecceModule,
    InstallationModule,
    ApprovalModule,
    AuditReviewModule,
    MediaModule,

    // Manual workflow — ad-hoc admin-defined task pipeline
    ManualModule,

    // Analytics — read-only reporting (admin dashboard + Vendor-HO console)
    AnalyticsModule,

    // Reports — per-tenant automated email digest + hourly cron
    ReportsModule,
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
    // RBAC permission enforcement — ALWAYS fail-closed: any @RequirePermission route is enforced
    // on every request (no env/tenant flag gate). Routes without the decorator (and @Public
    // routes) are unaffected.
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
