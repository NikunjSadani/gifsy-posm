import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Per-tenant POSM capture config (geo-fence) admin surface. Relies on the @Global PrismaModule. */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
