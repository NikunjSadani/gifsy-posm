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

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.posmTypes.list(user);
  }

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
