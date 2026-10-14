import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import {
  validateFormSchema,
  validateSubmittedValues,
  MEDIA_FIELD_TYPES,
  readMediaValue,
  FormField,
  VisibilityFormSchema,
} from '../capture/visibility-form.helper';
import { PosmMediaService } from '../capture/posm-media.service';
import { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import { CreateManualTaskDto } from './dto/create-manual-task.dto';
import { UpdateManualTaskDto } from './dto/update-manual-task.dto';
import { ListManualTasksDto } from './dto/list-manual-tasks.dto';
import { ListManualSubmissionsDto } from './dto/list-manual-submissions.dto';
import { SubmitManualTaskDto } from './dto/submit-manual-task.dto';
import { RejectManualSubmissionDto } from './dto/reject-manual-submission.dto';

/** JSON-safe snapshot for AuditLog / Json columns (Dates → ISO; strips undefined). */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/**
 * ManualService — the ad-hoc admin-defined task pipeline, SEPARATE from recce→install.
 *
 * Flow: a CLIENT_ADMIN / GIFSY_ADMIN defines a task (capture `formSchema`, optionally targeted
 * at one vendor fleet); a VENDOR_FIELD user fills + submits it; an admin directly approves /
 * rejects (no ASM / auditor stage).
 *
 * SECURITY (this gates who did what — identity-adjacent), enforced on EVERY read AND write:
 *   - Admins are pinned to their tenant (`tenantScope`); an un-assumed GIFSY_ADMIN is
 *     platform-wide, an assumed one is pinned to the assumed tenant.
 *   - A VENDOR_FIELD caller is confined by `vendorScope` FAIL-CLOSED: they only ever see /
 *     submit tasks whose `vendorId` is NULL (all fleets) or equals their own fleet. A missing
 *     vendorId on a vendor token matches NOTHING (never an unscoped read).
 *   - All state transitions are STATUS-GUARDED writes (`update where {..., status}` → P2025 →
 *     409), so a concurrent request can never double-review / double-submit.
 *   - The capture `formSchema` and a submission's `formValues` are validated by the reused
 *     capture form engine — never a bespoke validator.
 */
@Injectable()
export class ManualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: PosmMediaService,
    private readonly integrity: CaptureIntegrityService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Scoping helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /** The base `where` an ADMIN caller is confined to (tenant, or platform-wide for OWNER). */
  private adminTaskWhere(user: JwtPayload): Prisma.ManualTaskWhereInput {
    const where: Prisma.ManualTaskWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    return where;
  }

  /** The base `where` an ADMIN caller is confined to on submissions. */
  private adminSubmissionWhere(user: JwtPayload): Prisma.ManualTaskSubmissionWhereInput {
    const where: Prisma.ManualTaskSubmissionWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    return where;
  }

  /**
   * The `where` a VENDOR_FIELD caller is confined to on tasks: their tenant AND (task targets
   * all fleets OR their own fleet). Returns null = FAIL-CLOSED (a vendor token with no vendorId
   * must match NOTHING, never read unscoped).
   */
  private vendorTaskWhere(user: JwtPayload): Prisma.ManualTaskWhereInput | null {
    const v = vendorScope(user);
    if (!v) return null; // vendor role must never read unscoped
    return {
      clientId: user.clientId,
      OR: [{ vendorId: null }, { vendorId: v }],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN — task authoring
  // ─────────────────────────────────────────────────────────────────────────────

  /** POST /v1/manual/tasks — define a task. Validates formSchema via the form engine. */
  async createTask(user: JwtPayload, dto: CreateManualTaskDto) {
    const errors = validateFormSchema(dto.formSchema, { requireCamera: false });
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid formSchema', errors });
    }
    if (dto.vendorId) await this.assertVendorInTenant(user.clientId, dto.vendorId);

    const task = await this.prisma.manualTask.create({
      data: {
        clientId: user.clientId,
        title: dto.title,
        description: dto.description ?? null,
        formSchema: dto.formSchema as Prisma.InputJsonValue,
        vendorId: dto.vendorId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: user.sub,
      },
    });

    await this.audit(user, 'CREATE', 'MANUAL_TASK', task.id, null, {
      title: task.title,
      vendorId: task.vendorId,
      status: task.status,
    });
    return task;
  }

  /** GET /v1/manual/tasks — tenant-scoped list + per-task submission counts. */
  async listTasks(user: JwtPayload, q: ListManualTasksDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.ManualTaskWhereInput = { ...this.adminTaskWhere(user) };
    if (q.status) where.status = q.status;
    if (q.vendorId) where.vendorId = q.vendorId;

    const [tasks, total] = await Promise.all([
      this.prisma.manualTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.manualTask.count({ where }),
    ]);

    const counts = await this.submissionCounts(tasks.map((t) => t.id));
    const vendorNames = await this.vendorNames(
      tasks.map((t) => t.vendorId).filter((v): v is string => !!v),
    );

    const items = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      vendorId: t.vendorId,
      vendorName: t.vendorId ? (vendorNames.get(t.vendorId) ?? null) : null,
      dueDate: t.dueDate,
      status: t.status,
      createdAt: t.createdAt,
      submissionCounts: counts.get(t.id) ?? { submitted: 0, approved: 0, rejected: 0, total: 0 },
    }));

    return { items, total, page, limit };
  }

  /** GET /v1/manual/tasks/:id — task + its submissions (light rows). 404 if out of tenant. */
  async getTask(user: JwtPayload, id: string) {
    const task = await this.prisma.manualTask.findFirst({
      where: { ...this.adminTaskWhere(user), id },
    });
    if (!task) throw new NotFoundException('Task not found');

    const subs = await this.prisma.manualTaskSubmission.findMany({
      where: { taskId: task.id },
      orderBy: [{ createdAt: 'desc' }],
    });
    const names = await this.userNames(subs.map((s) => s.submittedById));
    const vendorName = task.vendorId
      ? (await this.vendorNames([task.vendorId])).get(task.vendorId) ?? null
      : null;

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      vendorId: task.vendorId,
      vendorName,
      dueDate: task.dueDate,
      status: task.status,
      formSchema: task.formSchema,
      createdById: task.createdById,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      submissions: subs.map((s) => ({
        id: s.id,
        submittedBy: { id: s.submittedById, name: names.get(s.submittedById) ?? null },
        vendorId: s.vendorId,
        status: s.status,
        version: s.version,
        reviewedAt: s.reviewedAt,
        createdAt: s.createdAt,
      })),
    };
  }

  /**
   * PATCH /v1/manual/tasks/:id — partial update. formSchema may change ONLY while the task has
   * zero submissions (else 409); it is re-validated when present. Only keys PRESENT on the body
   * are written (an explicit null clears vendorId/dueDate).
   */
  async updateTask(user: JwtPayload, id: string, dto: UpdateManualTaskDto) {
    const task = await this.prisma.manualTask.findFirst({
      where: { ...this.adminTaskWhere(user), id },
    });
    if (!task) throw new NotFoundException('Task not found');

    const data: Prisma.ManualTaskUpdateInput = {};

    if ('title' in dto && dto.title !== undefined) data.title = dto.title;
    if ('description' in dto) data.description = dto.description ?? null;
    if ('status' in dto && dto.status !== undefined) data.status = dto.status;

    if ('vendorId' in dto) {
      if (dto.vendorId) await this.assertVendorInTenant(task.clientId, dto.vendorId);
      data.vendorId = dto.vendorId ?? null;
    }

    if ('dueDate' in dto) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    if ('formSchema' in dto && dto.formSchema !== undefined) {
      // KNOWN RESIDUAL (LOW, display-only): count-then-update is a narrow TOCTOU — a submit
      // landing between this count and the update would be validated against the OLD schema but
      // rendered against the NEW one in review (mismatched labels). No security/data effect (the
      // stored formValues are untouched); not worth a row-lock/serializable tx for a manual task.
      const subCount = await this.prisma.manualTaskSubmission.count({ where: { taskId: task.id } });
      if (subCount > 0) {
        throw new ConflictException(
          'The capture form cannot be changed once the task has submissions.',
        );
      }
      const errors = validateFormSchema(dto.formSchema, { requireCamera: false });
      if (errors.length > 0) {
        throw new BadRequestException({ message: 'Invalid formSchema', errors });
      }
      data.formSchema = dto.formSchema as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.manualTask.update({ where: { id: task.id }, data });

    await this.audit(
      user,
      'UPDATE',
      'MANUAL_TASK',
      task.id,
      { title: task.title, vendorId: task.vendorId, status: task.status },
      { title: updated.title, vendorId: updated.vendorId, status: updated.status },
    );
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN — review
  // ─────────────────────────────────────────────────────────────────────────────

  /** GET /v1/manual/submissions — tenant-scoped review queue (default status SUBMITTED). */
  async listSubmissions(user: JwtPayload, q: ListManualSubmissionsDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.ManualTaskSubmissionWhereInput = {
      ...this.adminSubmissionWhere(user),
      status: q.status ?? 'SUBMITTED',
    };
    if (q.taskId) where.taskId = q.taskId;

    const [subs, total] = await Promise.all([
      this.prisma.manualTaskSubmission.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }], // FIFO review queue
        skip,
        take: limit,
        include: { task: { select: { title: true } } },
      }),
      this.prisma.manualTaskSubmission.count({ where }),
    ]);

    const names = await this.userNames(subs.map((s) => s.submittedById));
    const items = subs.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      taskTitle: s.task.title,
      submittedBy: { id: s.submittedById, name: names.get(s.submittedById) ?? null },
      vendorId: s.vendorId,
      status: s.status,
      version: s.version,
      createdAt: s.createdAt,
    }));

    return { items, total, page, limit };
  }

  /**
   * GET /v1/manual/submissions/:id — one scoped submission, its answers joined to the task's
   * form fields (media values resolved to a view-path). 404 if out of tenant.
   */
  async getSubmission(user: JwtPayload, id: string) {
    const sub = await this.prisma.manualTaskSubmission.findFirst({
      where: { ...this.adminSubmissionWhere(user), id },
      include: { task: { select: { id: true, title: true, formSchema: true } } },
    });
    if (!sub) throw new NotFoundException('Submission not found');

    const name = (await this.userNames([sub.submittedById])).get(sub.submittedById) ?? null;
    const schema = sub.task.formSchema as unknown as VisibilityFormSchema;
    const values = (sub.formValues ?? {}) as Record<string, unknown>;

    const fields = Array.isArray(schema?.fields) ? [...schema.fields] : [];
    fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const answers = fields.map((field) => this.answerFor(field, values[field.id]));
    // Advisory anti-fraud flag: a photo on this submission is byte-identical to one used on ANOTHER
    // submission (same-owner hashes ignored). Flag only — manual tasks are not a payout path.
    const duplicatePhoto = await this.submissionHasDuplicatePhoto(sub.clientId, sub.id, schema, values);

    return {
      id: sub.id,
      task: { id: sub.task.id, title: sub.task.title, formSchema: sub.task.formSchema },
      submittedBy: { id: sub.submittedById, name },
      vendorId: sub.vendorId,
      status: sub.status,
      version: sub.version,
      reviewedAt: sub.reviewedAt,
      rejectionReason: sub.rejectionReason,
      createdAt: sub.createdAt,
      duplicatePhoto,
      values: answers,
    };
  }

  /** POST /v1/manual/submissions/:id/approve — SUBMITTED → APPROVED (status-guarded). */
  async approveSubmission(user: JwtPayload, id: string) {
    const sub = await this.loadSubmissionForReview(user, id);

    const updated = await this.prisma.manualTaskSubmission
      .update({
        where: { id, status: 'SUBMITTED' },
        data: { status: 'APPROVED', reviewedById: user.sub, reviewedAt: new Date(), rejectionReason: null },
      })
      .catch((e) => this.conflictOnLostRace(e));

    await this.audit(user, 'APPROVE', 'MANUAL_SUBMISSION', id, { status: sub.status }, { status: 'APPROVED' });
    return updated;
  }

  /** POST /v1/manual/submissions/:id/reject — SUBMITTED → REJECTED with a required reason. */
  async rejectSubmission(user: JwtPayload, id: string, dto: RejectManualSubmissionDto) {
    const sub = await this.loadSubmissionForReview(user, id);

    const updated = await this.prisma.manualTaskSubmission
      .update({
        where: { id, status: 'SUBMITTED' },
        data: { status: 'REJECTED', reviewedById: user.sub, reviewedAt: new Date(), rejectionReason: dto.reason },
      })
      .catch((e) => this.conflictOnLostRace(e));

    await this.audit(
      user,
      'REJECT',
      'MANUAL_SUBMISSION',
      id,
      { status: sub.status },
      { status: 'REJECTED', reason: dto.reason },
    );
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VENDOR — field
  // ─────────────────────────────────────────────────────────────────────────────

  /** GET /v1/manual/my-tasks — OPEN tasks targeting my fleet, with my submission (if any). */
  async myTasks(user: JwtPayload) {
    const scope = this.vendorTaskWhere(user);
    if (scope === null) return { tasks: [] }; // fail-closed

    const tasks = await this.prisma.manualTask.findMany({
      where: { ...scope, status: 'OPEN' },
      orderBy: [{ createdAt: 'desc' }],
    });

    const mine = await this.prisma.manualTaskSubmission.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) }, submittedById: user.sub },
      select: { taskId: true, status: true, version: true, rejectionReason: true },
    });
    const byTask = new Map(mine.map((m) => [m.taskId, m]));

    const items = tasks.map((t) => {
      const s = byTask.get(t.id);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate,
        formSchema: t.formSchema,
        mySubmission: s
          ? { status: s.status, version: s.version, rejectionReason: s.rejectionReason ?? null }
          : null,
      };
    });

    return { tasks: items };
  }

  /**
   * POST /v1/manual/tasks/:id/submit — fill + submit a task's form.
   *
   * Eligibility (fail-closed): the task must exist in my tenant AND target my fleet (else 404 —
   * a foreign-fleet / other-tenant task is INVISIBLE) AND be OPEN (else 409). The answers are
   * validated against the task's stored schema by the form engine (400 on invalid). Then:
   *   - no prior submission → create (SUBMITTED, version 1);
   *   - my latest is REJECTED → re-capture in place (version++, SUBMITTED, clear rejection);
   *   - my latest is SUBMITTED / APPROVED → 409 (already submitted).
   */
  async submitTask(user: JwtPayload, taskId: string, dto: SubmitManualTaskDto) {
    const v = vendorScope(user);
    const scope = this.vendorTaskWhere(user);
    if (scope === null || !v) throw new NotFoundException('Task not found'); // fail-closed

    const task = await this.prisma.manualTask.findFirst({ where: { ...scope, id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== 'OPEN') {
      throw new ConflictException('This task is closed and no longer accepts submissions.');
    }

    const schema = task.formSchema as unknown as VisibilityFormSchema;
    const { errors, values } = validateSubmittedValues(schema, dto.formValues);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid submission', errors });
    }

    const existing = await this.prisma.manualTaskSubmission.findUnique({
      where: { taskId_submittedById: { taskId: task.id, submittedById: user.sub } },
      select: { id: true, status: true, version: true },
    });

    // Re-capture in place — only a REJECTED submission may be re-filled.
    if (existing) {
      if (existing.status !== 'REJECTED') {
        throw new ConflictException('You have already submitted this task.');
      }
      const updated = await this.prisma.manualTaskSubmission
        .update({
          where: { id: existing.id, status: 'REJECTED' },
          data: {
            formValues: values as Prisma.InputJsonValue,
            status: 'SUBMITTED',
            version: { increment: 1 },
            vendorId: v,
            rejectionReason: null,
            reviewedById: null,
            reviewedAt: null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      // Re-hash the re-captured photos (advisory duplicate signal; same-owner hashes are ignored).
      await this.recordSubmissionHashes(user.clientId, existing.id, schema, values);
      await this.audit(
        user,
        'UPDATE',
        'MANUAL_SUBMISSION',
        existing.id,
        { status: 'REJECTED', version: existing.version },
        { status: 'SUBMITTED', version: updated.version },
      );
      return updated;
    }

    // First submission — create. The @@unique([taskId, submittedById]) closes the concurrent-
    // create race (P2002 → 409).
    try {
      const created = await this.prisma.manualTaskSubmission.create({
        data: {
          clientId: user.clientId,
          taskId: task.id,
          submittedById: user.sub,
          vendorId: v,
          formValues: values as Prisma.InputJsonValue,
          status: 'SUBMITTED',
          version: 1,
        },
      });
      // Record photo content-hashes (ownerKind MANUAL) for cross-submission duplicate detection —
      // surfaced as an ADVISORY flag at review; never blocks (manual tasks are not a payout path).
      await this.recordSubmissionHashes(user.clientId, created.id, schema, values);
      await this.audit(user, 'CREATE', 'MANUAL_SUBMISSION', created.id, null, {
        status: 'SUBMITTED',
        version: 1,
        taskId: task.id,
      });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('You have already submitted this task.');
      }
      throw e;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────────

  /** Load a submission for a review transition (scoped 404); asserts it is still SUBMITTED (409). */
  private async loadSubmissionForReview(user: JwtPayload, id: string) {
    const sub = await this.prisma.manualTaskSubmission.findFirst({
      where: { ...this.adminSubmissionWhere(user), id },
      select: { id: true, status: true },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    if (sub.status !== 'SUBMITTED') {
      throw new ConflictException(`Submission is already ${sub.status} and can no longer be reviewed.`);
    }
    return sub;
  }

  /**
   * A status-guarded single-item write matched 0 rows — a concurrent request transitioned the
   * row between the load and the write (Prisma P2025). Re-map to 409 so the loser never appends a
   * duplicate audit row. Any other error propagates. Returns `never`.
   */
  private conflictOnLostRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new ConflictException(
        'This submission was changed by a concurrent request and can no longer be updated.',
      );
    }
    throw e;
  }

  /** The photo keys stored across a submission's media (CAMERA/…) fields. */
  private collectMediaKeys(schema: VisibilityFormSchema, values: Record<string, unknown>): string[] {
    const keys: string[] = [];
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    for (const f of fields) {
      if (!MEDIA_FIELD_TYPES.has(f.type)) continue;
      const raw = values[f.id];
      if (raw == null) continue;
      const { key } = readMediaValue(raw);
      if (key) keys.push(key);
    }
    return keys;
  }

  /**
   * Record a submission's photo content-hashes under `ownerKind:'MANUAL'` so the SAME photo reused
   * across manual submissions is detectable. Best-effort + NON-blocking: a missing object contributes
   * no hash, and any hashing/record error is swallowed (the submission must still succeed — manual
   * tasks are not a payout path, so this is an advisory signal, never a hard block).
   */
  private async recordSubmissionHashes(
    clientId: string,
    submissionId: string,
    schema: VisibilityFormSchema,
    values: Record<string, unknown>,
  ): Promise<void> {
    try {
      const keys = this.collectMediaKeys(schema, values);
      if (keys.length === 0) return;
      const hashes: string[] = [];
      for (const key of keys) {
        const bytes = await this.integrity.fetchImageBytes(key);
        if (bytes) hashes.push(this.integrity.hash(bytes));
      }
      if (hashes.length === 0) return;
      await this.media.recordImageHashes(
        this.prisma,
        clientId,
        { ownerKind: 'MANUAL', ownerId: submissionId },
        hashes,
      );
    } catch {
      // Advisory only — never fail a submission because hashing/recording hiccupped.
    }
  }

  /**
   * Advisory duplicate signal: recompute THIS submission's photo content-hashes and check whether any
   * appears in the shared ImageHash store under a DIFFERENT owner (another submission / recce / install).
   * Recomputed rather than read from this submission's own rows because the `(clientId, hash)` unique
   * only persists the FIRST occurrence — so this flags the REUSE (the fraud signal), exactly as the
   * recce lane does. Never blocks.
   */
  private async submissionHasDuplicatePhoto(
    clientId: string,
    submissionId: string,
    schema: VisibilityFormSchema,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const keys = this.collectMediaKeys(schema, values);
    if (keys.length === 0) return false;
    const hashes: string[] = [];
    for (const key of keys) {
      const bytes = await this.integrity.fetchImageBytes(key);
      if (bytes) hashes.push(this.integrity.hash(bytes));
    }
    if (hashes.length === 0) return false;
    const other = await this.prisma.imageHash.findFirst({
      where: {
        clientId,
        hash: { in: [...new Set(hashes)] },
        NOT: { ownerKind: 'MANUAL', ownerId: submissionId },
      },
      select: { id: true },
    });
    return other != null;
  }

  /** Assert a vendorId is an existing vendor in this tenant (no foreign-fleet targeting). */
  private async assertVendorInTenant(clientId: string, vendorId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, clientId },
      select: { id: true },
    });
    if (!vendor) throw new BadRequestException('vendorId is not a vendor in this tenant.');
  }

  /** Per-task submission counts {submitted, approved, rejected, total}. */
  private async submissionCounts(taskIds: string[]) {
    const map = new Map<string, { submitted: number; approved: number; rejected: number; total: number }>();
    if (taskIds.length === 0) return map;
    const grouped = await this.prisma.manualTaskSubmission.groupBy({
      by: ['taskId', 'status'],
      where: { taskId: { in: taskIds } },
      _count: { _all: true },
    });
    for (const id of taskIds) map.set(id, { submitted: 0, approved: 0, rejected: 0, total: 0 });
    for (const g of grouped) {
      const row = map.get(g.taskId)!;
      const n = g._count._all;
      row.total += n;
      if (g.status === 'SUBMITTED') row.submitted += n;
      else if (g.status === 'APPROVED') row.approved += n;
      else if (g.status === 'REJECTED') row.rejected += n;
    }
    return map;
  }

  /** id → user name, batched. */
  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id, r.name);
    return map;
  }

  /** id → vendor name, batched. */
  private async vendorNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const rows = await this.prisma.vendor.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id, r.name);
    return map;
  }

  /** Join a form field to its stored answer, resolving a media value to a render view-path. */
  private answerFor(field: FormField, rawValue: unknown) {
    const base: { field: FormField; value: unknown; media?: { key: string; viewPath: string; geo: unknown } } = {
      field,
      value: rawValue ?? null,
    };
    if (MEDIA_FIELD_TYPES.has(field.type) && rawValue != null) {
      const { key, geo } = readMediaValue(rawValue);
      if (key) {
        base.media = {
          key,
          viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
          geo: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null,
        };
      }
    }
    return base;
  }

  /** Append-only audit write (chassis AuditLog pattern). */
  private audit(
    user: JwtPayload,
    action: 'CREATE' | 'UPDATE' | 'APPROVE' | 'REJECT',
    entityType: 'MANUAL_TASK' | 'MANUAL_SUBMISSION',
    entityId: string,
    oldValues: unknown,
    newValues: unknown,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action,
        entityType,
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
