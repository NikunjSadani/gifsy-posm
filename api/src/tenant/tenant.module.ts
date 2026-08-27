import { Global, Module } from '@nestjs/common';
import { TenantService } from './tenant.service';

/**
 * Global so the PermissionGuard (APP_GUARD) and any domain module can inject
 * TenantService without re-importing. Its only dependency is the @Global PrismaService.
 */
@Global()
@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
