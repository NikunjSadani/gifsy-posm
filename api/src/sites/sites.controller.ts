import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UploadedFile, UseInterceptors, HttpCode, HttpStatus, StreamableFile,
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

  /**
   * GET /v1/sites/bulk-upload/template — a blank .xlsx (header row only) to fill and re-upload.
   * Declared before the POST; served as a StreamableFile with an attachment disposition (the
   * global interceptor passes StreamableFile through unwrapped).
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Get('bulk-upload/template')
  template(): StreamableFile {
    return new StreamableFile(this.sites.buildUploadTemplate(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="outlet-upload-template.xlsx"',
    });
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

  /**
   * GET /v1/sites/bulk-deactivate/template — a blank .xlsx (only a `code` header) to fill and
   * re-upload to the bulk-deactivate endpoint. Declared before the POST and before `:id`.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Get('bulk-deactivate/template')
  deactivateTemplate(): StreamableFile {
    return new StreamableFile(this.sites.buildDeactivateTemplate(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="outlet-deactivate-template.xlsx"',
    });
  }

  /**
   * POST /v1/sites/bulk-deactivate — deactivate outlets in bulk from an .xlsx of `code`s. Each
   * ACTIVE outlet is soft-deleted via the same mechanism as the single endpoint; an already-inactive
   * code is a no-op success; an unknown code is an error row. Returns the shared BulkUploadResult.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Post('bulk-deactivate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  bulkDeactivate(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    return this.sites.bulkDeactivate(user, file);
  }

  /** POST /v1/sites — create. */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSiteDto) {
    return this.sites.create(user, dto);
  }

  /**
   * GET /v1/sites/filter-options/rs-codes — distinct RS codes, each with a representative RS
   * name (`{ rsCodes: Array<{ code, name }> }`), among the caller's scoped sites (the field
   * RS-code drop-down source, which shows code + name). Scoped exactly like the list.
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

  /**
   * GET /v1/sites/lookup?outletId=<X> — exact Outlet ID resolution for the Manual Recce
   * warn-and-prefill UX. Vendor-scoped for a field exec, tenant-scoped for an admin. Declared
   * before `:id` so the literal segment wins the route match.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'VENDOR_FIELD')
  @Get('lookup')
  lookup(@CurrentUser() user: JwtPayload, @Query('outletId') outletId?: string) {
    return this.sites.lookup(user, outletId);
  }

  /**
   * GET /v1/sites/:id — scoped single fetch. VENDOR_FIELD is included so the field recce page can
   * resolve ONE outlet authoritatively (e.g. its `gsbAllowed` gate) instead of scanning a capped
   * list: `SitesService.get` pins the vendor (and tenant) in `scopedWhere`, so a field login can
   * only ever read an outlet its own vendor services (404 otherwise) — the same confinement, and
   * the same row shape, as the list it already consumes.
   */
  @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'VENDOR_FIELD')
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
