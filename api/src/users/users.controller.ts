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
  UploadedFile,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * Human-login admin API — served under /v1/users.
 * Manages CLIENT_ADMIN / ASM / AUDITOR / VENDOR_HO / VENDOR_FIELD logins (not GIFSY_ADMIN).
 */
@Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.users.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.get(user, id);
  }

  /**
   * GET /v1/users/bulk-upload/template — a blank .xlsx (header row only) to fill and re-upload.
   * Declared before the POST so it is unambiguous; served as a StreamableFile with an attachment
   * disposition (the global interceptor passes StreamableFile through unwrapped).
   */
  @Get('bulk-upload/template')
  template(): StreamableFile {
    return new StreamableFile(this.users.buildUploadTemplate(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="user-upload-template.xlsx"',
    });
  }

  /**
   * POST /v1/users/bulk-upload — Excel bulk-ingestion with a base64 rejection report. New phones
   * are created; an existing phone updates ONLY name + promoter code (role/vendor never change).
   */
  @Post('bulk-upload')
  @HttpCode(HttpStatus.OK)
  // F2: cap the raw upload at 5 MB before it reaches the parser.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  bulkUpload(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    return this.users.bulkUpload(user, file);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user, id, dto);
  }

  /** Soft-deactivate (isActive=false) and evict all live sessions immediately. */
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.deactivate(user, id);
  }
}
