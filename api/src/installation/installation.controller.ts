import {
  Controller, Get, Post, Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { InstallationService } from './installation.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateInstallationDto } from './dto/create-installation.dto';

/**
 * Installation field-capture — Wave 2 CAPTURE lane.
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide; every
 * route declares an explicit @Roles floor of VENDOR_FIELD. Cross-tenant AND cross-vendor
 * confinement is enforced fail-closed inside the service, as is the "recce must be APPROVED"
 * gate.
 */
@Controller('installation')
export class InstallationController {
  constructor(private readonly installation: InstallationService) {}

  /** POST /v1/installation — submit one site's installation (recce must be APPROVED). */
  @Roles('VENDOR_FIELD')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInstallationDto) {
    return this.installation.create(user, dto);
  }

  /** GET /v1/installation/:id — a single installation with both photos + integrity signals. */
  @Roles('VENDOR_FIELD')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.installation.get(user, id);
  }
}
