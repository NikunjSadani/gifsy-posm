import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateCaptureConfigDto } from './dto/update-capture-config.dto';

/**
 * Admin settings — per-tenant POSM capture config (the geo-fence). Tenant-scoped by the
 * caller's clientId inside the service; admin roles only.
 */
@Controller('settings')
@Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** GET /v1/settings/capture — the tenant's effective geo-fence config. */
  @Get('capture')
  getCapture(@CurrentUser() user: JwtPayload) {
    return this.settings.getCaptureConfig(user);
  }

  /** PUT /v1/settings/capture — save the geo-fence config, return the effective value. */
  @Put('capture')
  putCapture(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCaptureConfigDto) {
    return this.settings.putCaptureConfig(user, dto);
  }
}
