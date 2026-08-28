import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ManualService } from './manual.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateManualTaskDto } from './dto/create-manual-task.dto';
import { UpdateManualTaskDto } from './dto/update-manual-task.dto';
import { ListManualTasksDto } from './dto/list-manual-tasks.dto';
import { ListManualSubmissionsDto } from './dto/list-manual-submissions.dto';
import { SubmitManualTaskDto } from './dto/submit-manual-task.dto';
import { RejectManualSubmissionDto } from './dto/reject-manual-submission.dto';

/**
 * Manual-workflow console — the ad-hoc admin-defined task pipeline (SEPARATE from recce→install).
 *
 * The global guard chain (Throttler → JwtAuth → Roles → Tenant → Permission) is app-wide; every
 * route declares an explicit @Roles floor. Admin routes are pinned to ADMIN roles, vendor routes
 * to VENDOR_FIELD. Cross-tenant AND cross-fleet confinement is enforced inside the service on
 * every read AND every state transition.
 */
@Controller('manual')
export class ManualController {
  constructor(private readonly manual: ManualService) {}

  // ── ADMIN — task authoring + review ──────────────────────────────────────────

  /** POST /v1/manual/tasks — define an ad-hoc task. */
  @Post('tasks')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  createTask(@CurrentUser() user: JwtPayload, @Body() dto: CreateManualTaskDto) {
    return this.manual.createTask(user, dto);
  }

  /** GET /v1/manual/tasks — tenant-scoped task list + submission counts. */
  @Get('tasks')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  listTasks(@CurrentUser() user: JwtPayload, @Query() query: ListManualTasksDto) {
    return this.manual.listTasks(user, query);
  }

  /** GET /v1/manual/submissions — tenant-scoped review queue (default SUBMITTED). */
  @Get('submissions')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  listSubmissions(@CurrentUser() user: JwtPayload, @Query() query: ListManualSubmissionsDto) {
    return this.manual.listSubmissions(user, query);
  }

  /** GET /v1/manual/submissions/:id — one scoped submission (answers joined to fields). */
  @Get('submissions/:id')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  getSubmission(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manual.getSubmission(user, id);
  }

  /** POST /v1/manual/submissions/:id/approve — SUBMITTED → APPROVED. */
  @Post('submissions/:id/approve')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manual.approveSubmission(user, id);
  }

  /** POST /v1/manual/submissions/:id/reject — SUBMITTED → REJECTED with a required reason. */
  @Post('submissions/:id/reject')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RejectManualSubmissionDto,
  ) {
    return this.manual.rejectSubmission(user, id, dto);
  }

  /** GET /v1/manual/tasks/:id — task + its submissions. */
  @Get('tasks/:id')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  getTask(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.manual.getTask(user, id);
  }

  /** PATCH /v1/manual/tasks/:id — partial update (formSchema only while 0 submissions). */
  @Patch('tasks/:id')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
  updateTask(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateManualTaskDto,
  ) {
    return this.manual.updateTask(user, id, dto);
  }

  // ── VENDOR — field ───────────────────────────────────────────────────────────

  /** GET /v1/manual/my-tasks — OPEN tasks targeting my fleet + my submission state. */
  @Get('my-tasks')
  @Roles('VENDOR_FIELD')
  myTasks(@CurrentUser() user: JwtPayload) {
    return this.manual.myTasks(user);
  }

  /** POST /v1/manual/tasks/:id/submit — fill + submit (create or re-capture a REJECTED one). */
  @Post('tasks/:id/submit')
  @Roles('VENDOR_FIELD')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SubmitManualTaskDto,
  ) {
    return this.manual.submitTask(user, id, dto);
  }
}
