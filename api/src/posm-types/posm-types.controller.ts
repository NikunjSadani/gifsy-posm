import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PosmTypesService } from './posm-types.service';
import { CreatePosmTypeDto } from './dto/create-posm-type.dto';
import { UpdatePosmTypeDto } from './dto/update-posm-type.dto';

/** POSM-type master admin API — served under /v1/posm-types. */
@Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
@Controller('posm-types')
export class PosmTypesController {
  constructor(private readonly posmTypes: PosmTypesService) {}

  /**
   * The POSM-type catalogue (tenant-scoped reference data). Widened beyond the admin floor to
   * the vendor field roles: a VENDOR_FIELD rep must pick a POSM type during recce capture. This
   * is READ-ONLY reference data — the write handlers below keep the admin-only class floor. The
   * method-level @Roles overrides the class-level one for this handler.
   */
  @Roles('VENDOR_FIELD', 'VENDOR_HO', 'ASM', 'AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN')
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.posmTypes.list(user);
  }

  // Same roles as the list: "can see it in the list ⇒ can fetch it by id" (read-only reference data).
  // The service keeps non-admins to ACTIVE types only, mirroring list(); writes stay admin-only below.
  @Roles('VENDOR_FIELD', 'VENDOR_HO', 'ASM', 'AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posmTypes.get(user, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePosmTypeDto) {
    return this.posmTypes.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePosmTypeDto,
  ) {
    return this.posmTypes.update(user, id, dto);
  }

  /** Soft-deactivate the POSM type (isActive=false). Not a hard delete. */
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posmTypes.deactivate(user, id);
  }
}
