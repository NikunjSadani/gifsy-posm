import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UploadedFile, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SitesService } from './sites.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { ListSitesDto } from './dto/list-sites.dto';

/**
 * Site master — Wave 1.
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide;
 * every route below declares an explicit @Roles floor. Cross-tenant AND cross-vendor
 * confinement is enforced inside the service (see SitesService.scopedWhere).
 */
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  /** GET /v1/sites — role-scoped list/search/filter. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'ASM', 'VENDOR_HO', 'VENDOR_FIELD')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListSitesDto) {
    return this.sites.list(user, query);
  }

  /** POST /v1/sites/bulk-upload — Excel bulk-ingestion with a base64 rejection report. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Post('bulk-upload')
  @HttpCode(HttpStatus.OK)
  // F2: cap the raw upload at 5 MB — a larger multipart part is rejected by Multer before it
  // ever reaches the parser, bounding the memory/CPU an untrusted upload can consume.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  bulkUpload(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    return this.sites.bulkUpload(user, file);
  }

  /** POST /v1/sites — create. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSiteDto) {
    return this.sites.create(user, dto);
  }

  /**
   * GET /v1/sites/filter-options/rs-codes — distinct RS codes among the caller's scoped
   * sites (the field RS-code drop-down source). Scoped exactly like the list.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'VENDOR_FIELD')
  @Get('filter-options/rs-codes')
  rsCodeOptions(@CurrentUser() user: JwtPayload) {
    return this.sites.rsCodeOptions(user);
  }

  /**
   * GET /v1/sites/filter-options/beats?rsCode=<X> — distinct Beats for one exact RS code
   * among the caller's scoped sites (the dependent Beat drop-down). `rsCode` is required.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'VENDOR_FIELD')
  @Get('filter-options/beats')
  beatOptions(@CurrentUser() user: JwtPayload, @Query('rsCode') rsCode?: string) {
    return this.sites.beatOptions(user, rsCode);
  }

  /** GET /v1/sites/:id — scoped single fetch. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sites.get(user, id);
  }

  /** PATCH /v1/sites/:id — update. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.sites.update(user, id, dto);
  }

  /** PATCH /v1/sites/:id/deactivate — soft-delete (status → INACTIVE). */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Patch(':id/deactivate')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sites.deactivate(user, id);
  }
}
