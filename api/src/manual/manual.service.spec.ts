import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { ManualService } from './manual.service';
import { RejectManualSubmissionDto } from './dto/reject-manual-submission.dto';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/** A Prisma "record to update not found" error — what a 0-row status-guarded write throws. */
const notFoundError = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'x',
  } as never);

/** A Prisma unique-constraint error — what a concurrent create hits on @@unique. */
const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
    code: 'P2002',
    clientVersion: 'x',
  } as never);

/** A minimal VALID capture-form schema (>=1 CAMERA field, per the form engine). */
const validSchema = () => ({
  captureGpsOnSubmit: false,
  fields: [
    { id: 'photo', type: 'CAMERA', label: 'Store photo', required: true, order: 1 },
    { id: 'note', type: 'TEXT', label: 'Note', required: false, order: 2 },
  ],
});

function makePrisma() {
  const fns: Record<string, any> = {
    manualTask: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    manualTaskSubmission: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    vendor: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    imageHash: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
  };
  return { prisma: fns as unknown as PrismaService, fns };
}

// Capture-media + integrity collaborators (hash-on-submit / dup-at-review). Defaults: no bytes → no
// hashes recorded (harmless for the non-media tests); override per-test where the hash path matters.
const mediaMock = () => ({ recordImageHashes: jest.fn().mockResolvedValue({ dupHashes: [] }) }) as any;
const integrityMock = () => ({ fetchImageBytes: jest.fn().mockResolvedValue(null), hash: jest.fn().mockReturnValue('h') }) as any;

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});
const admin = (over: Partial<JwtPayload> = {}) => user({ role: 'CLIENT_ADMIN', clientId: 'c1', ...over });
const vendor = (over: Partial<JwtPayload> = {}) =>
  user({ role: 'VENDOR_FIELD', clientId: 'c1', sub: 'vf1', vendorId: 'v1', ...over });

// ─────────────────────────────────────────────────────────────────────────────
// createTask — form-engine validation + tenant/vendor stamping + audit
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.createTask', () => {
  it('rejects an INVALID formSchema (delegates to the form engine) → 400, never writes', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(
      svc.createTask(admin(), { title: 'T', formSchema: { fields: [] } } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.manualTask.create).not.toHaveBeenCalled();
  });

  it('creates a task stamping clientId + createdById, writes a CREATE audit row', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.create.mockResolvedValue({ id: 't1', title: 'T', vendorId: null, status: 'OPEN' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.createTask(admin({ sub: 'admin-9' }), { title: 'T', formSchema: validSchema() } as any);
    const data = fns.manualTask.create.mock.calls[0][0].data;
    expect(data.clientId).toBe('c1');
    expect(data.createdById).toBe('admin-9');
    expect(data.vendorId).toBeNull();
    const audit = fns.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'CREATE', entityType: 'MANUAL_TASK', entityId: 't1', actorId: 'admin-9' });
  });

  it('rejects a vendorId that is not a vendor in the tenant → 400', async () => {
    const { prisma, fns } = makePrisma();
    fns.vendor.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(
      svc.createTask(admin(), { title: 'T', vendorId: 'foreign', formSchema: validSchema() } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.vendor.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'foreign', clientId: 'c1' });
    expect(fns.manualTask.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listTasks — tenant scoping + submission counts
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.listTasks — scoping + counts', () => {
  it('CLIENT_ADMIN: where pins clientId', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.listTasks(admin(), {});
    expect(fns.manualTask.findMany.mock.calls[0][0].where.clientId).toBe('c1');
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.listTasks(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), {});
    expect(fns.manualTask.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('maps per-task submission counts from groupBy', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findMany.mockResolvedValue([
      { id: 't1', title: 'A', description: null, vendorId: null, dueDate: null, status: 'OPEN', createdAt: new Date() },
    ]);
    fns.manualTaskSubmission.groupBy.mockResolvedValue([
      { taskId: 't1', status: 'SUBMITTED', _count: { _all: 2 } },
      { taskId: 't1', status: 'APPROVED', _count: { _all: 1 } },
    ]);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.listTasks(admin(), {});
    expect(res.items[0].submissionCounts).toEqual({ submitted: 2, approved: 1, rejected: 0, total: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTask — scoped detail
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.getTask', () => {
  it('an id outside the caller tenant (findFirst → null) → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.getTask(admin(), 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.manualTask.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'x', clientId: 'c1' });
  });

  it('returns the task + submissions with resolved submitter names', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({
      id: 't1', title: 'A', description: null, vendorId: null, dueDate: null, status: 'OPEN',
      formSchema: validSchema(), createdById: 'admin-9', createdAt: new Date(), updatedAt: new Date(),
    });
    fns.manualTaskSubmission.findMany.mockResolvedValue([
      { id: 's1', submittedById: 'vf1', vendorId: 'v1', status: 'SUBMITTED', version: 1, reviewedAt: null, createdAt: new Date() },
    ]);
    fns.user.findMany.mockResolvedValue([{ id: 'vf1', name: 'Field One' }]);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.getTask(admin(), 't1');
    expect(res.submissions[0]).toMatchObject({ id: 's1', vendorId: 'v1', status: 'SUBMITTED', version: 1 });
    expect(res.submissions[0].submittedBy).toEqual({ id: 'vf1', name: 'Field One' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateTask — formSchema guarded by submission count
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.updateTask', () => {
  const existingTask = () => ({ id: 't1', clientId: 'c1', title: 'Old', vendorId: null, status: 'OPEN' });

  it('formSchema change is REFUSED (409) once the task has submissions', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue(existingTask());
    fns.manualTaskSubmission.count.mockResolvedValue(3);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(
      svc.updateTask(admin(), 't1', { formSchema: validSchema() } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fns.manualTask.update).not.toHaveBeenCalled();
  });

  it('formSchema change with 0 submissions is re-validated (invalid → 400)', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue(existingTask());
    fns.manualTaskSubmission.count.mockResolvedValue(0);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(
      svc.updateTask(admin(), 't1', { formSchema: { fields: [] } } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.manualTask.update).not.toHaveBeenCalled();
  });

  it('an explicit null vendorId clears the fleet target; audit UPDATE written', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ ...existingTask(), vendorId: 'v1' });
    fns.manualTask.update.mockResolvedValue({ id: 't1', title: 'Old', vendorId: null, status: 'OPEN' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.updateTask(admin(), 't1', { vendorId: null } as any);
    expect(fns.manualTask.update.mock.calls[0][0].data.vendorId).toBeNull();
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('UPDATE');
  });

  it('id outside tenant → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.updateTask(admin(), 'x', { title: 'X' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listSubmissions — review queue defaults to SUBMITTED
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.listSubmissions', () => {
  it('defaults to status SUBMITTED, tenant-scoped, joins taskTitle', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findMany.mockResolvedValue([
      { id: 's1', taskId: 't1', submittedById: 'vf1', vendorId: 'v1', status: 'SUBMITTED', version: 1, createdAt: new Date(), task: { title: 'A' } },
    ]);
    fns.user.findMany.mockResolvedValue([{ id: 'vf1', name: 'Field One' }]);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.listSubmissions(admin(), {});
    const where = fns.manualTaskSubmission.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ clientId: 'c1', status: 'SUBMITTED' });
    expect(res.items[0]).toMatchObject({ id: 's1', taskId: 't1', taskTitle: 'A' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSubmission — answers joined to fields + media view-path
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.getSubmission', () => {
  const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1', clientId: 'c1', submittedById: 'vf1', vendorId: 'v1', status: 'SUBMITTED', version: 1,
    reviewedAt: null, rejectionReason: null, createdAt: new Date(),
    formValues: { photo: 'posm-media/c1/a.jpg' }, task: { id: 't1', title: 'A', formSchema: validSchema() },
    ...over,
  });

  it('duplicatePhoto=true when a photo hash is seen under ANOTHER owner', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue(subRow());
    const integrity = { fetchImageBytes: jest.fn().mockResolvedValue(Buffer.from('x')), hash: jest.fn().mockReturnValue('H1') } as any;
    fns.imageHash.findFirst.mockResolvedValue({ id: 'other-owner-row' }); // same hash, different owner
    const svc = new ManualService(prisma, mediaMock(), integrity);
    expect((await svc.getSubmission(admin(), 's1')).duplicatePhoto).toBe(true);
    // the cross-owner lookup EXCLUDES this submission's own rows
    expect(fns.imageHash.findFirst.mock.calls[0][0].where.NOT).toEqual({ ownerKind: 'MANUAL', ownerId: 's1' });
  });

  it('duplicatePhoto=false when the photo is not seen elsewhere', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue(subRow());
    const integrity = { fetchImageBytes: jest.fn().mockResolvedValue(Buffer.from('x')), hash: jest.fn().mockReturnValue('H1') } as any;
    fns.imageHash.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrity);
    expect((await svc.getSubmission(admin(), 's1')).duplicatePhoto).toBe(false);
  });

  it('out of tenant → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.getSubmission(admin(), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('joins each answer to its field and resolves a CAMERA value to a viewPath', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({
      id: 's1', submittedById: 'vf1', vendorId: 'v1', status: 'SUBMITTED', version: 1,
      reviewedAt: null, rejectionReason: null, createdAt: new Date(),
      formValues: { photo: 'posm-media/c1/a.jpg', note: 'hi' },
      task: { id: 't1', title: 'A', formSchema: validSchema() },
    });
    fns.user.findMany.mockResolvedValue([{ id: 'vf1', name: 'Field One' }]);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.getSubmission(admin(), 's1');
    const photoAnswer = res.values.find((v: any) => v.field.id === 'photo')!;
    expect(photoAnswer.media!.viewPath).toBe('/v1/media/view?key=posm-media%2Fc1%2Fa.jpg');
    const noteAnswer = res.values.find((v: any) => v.field.id === 'note')!;
    expect(noteAnswer.value).toBe('hi');
    expect(noteAnswer.media).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// approve / reject — status-guarded transitions
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.approveSubmission', () => {
  it('SUBMITTED → APPROVED, stamps reviewedById/reviewedAt, audit APPROVE', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({ id: 's1', status: 'SUBMITTED' });
    fns.manualTaskSubmission.update.mockResolvedValue({ id: 's1', status: 'APPROVED' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.approveSubmission(admin({ sub: 'admin-9' }), 's1');
    const call = fns.manualTaskSubmission.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', status: 'SUBMITTED' });
    expect(call.data).toMatchObject({ status: 'APPROVED', reviewedById: 'admin-9' });
    expect(call.data.reviewedAt).toBeInstanceOf(Date);
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('APPROVE');
  });

  it('already-reviewed (APPROVED) → 409, never writes', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({ id: 's1', status: 'APPROVED' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.approveSubmission(admin(), 's1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.manualTaskSubmission.update).not.toHaveBeenCalled();
  });

  it('a concurrent transition whose guarded write matches 0 rows (P2025) → 409, NO audit', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({ id: 's1', status: 'SUBMITTED' });
    fns.manualTaskSubmission.update.mockRejectedValue(notFoundError());
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.approveSubmission(admin(), 's1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });

  it('out of tenant → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.approveSubmission(admin(), 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.manualTaskSubmission.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'x', clientId: 'c1' });
  });
});

describe('ManualService.rejectSubmission', () => {
  it('SUBMITTED → REJECTED, stores the reason, audit REJECT', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({ id: 's1', status: 'SUBMITTED' });
    fns.manualTaskSubmission.update.mockResolvedValue({ id: 's1', status: 'REJECTED' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.rejectSubmission(admin(), 's1', { reason: 'Blurry photo' });
    const call = fns.manualTaskSubmission.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', status: 'SUBMITTED' });
    expect(call.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Blurry photo' });
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('REJECT');
  });

  it('reject on an already-REJECTED submission → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTaskSubmission.findFirst.mockResolvedValue({ id: 's1', status: 'REJECTED' });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.rejectSubmission(admin(), 's1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RejectManualSubmissionDto — a non-empty reason is required', () => {
  it('rejects a missing reason', async () => {
    const errors = await validate(plainToInstance(RejectManualSubmissionDto, {}));
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });
  it('rejects a whitespace-only reason (trimmed → empty)', async () => {
    const errors = await validate(plainToInstance(RejectManualSubmissionDto, { reason: '   ' }));
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });
  it('accepts a real reason', async () => {
    const errors = await validate(plainToInstance(RejectManualSubmissionDto, { reason: 'Blurry' }));
    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// myTasks — vendor fleet confinement (fail-closed) + OR(null, myVendor)
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.myTasks — vendor confinement', () => {
  it('FAIL-CLOSED: a vendor token with NO vendorId returns nothing (never unscoped)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.myTasks(vendor({ vendorId: undefined }));
    expect(res.tasks).toEqual([]);
    expect(fns.manualTask.findMany).not.toHaveBeenCalled();
  });

  it('scopes to OPEN tasks whose vendorId is NULL (all) OR == my fleet, in my tenant', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.myTasks(vendor());
    const where = fns.manualTask.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.status).toBe('OPEN');
    expect(where.OR).toEqual([{ vendorId: null }, { vendorId: 'v1' }]);
  });

  it('attaches my own submission state per task (null when I have none)', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findMany.mockResolvedValue([
      { id: 't1', title: 'A', description: null, dueDate: null, formSchema: validSchema() },
      { id: 't2', title: 'B', description: null, dueDate: null, formSchema: validSchema() },
    ]);
    fns.manualTaskSubmission.findMany.mockResolvedValue([
      { taskId: 't1', status: 'REJECTED', version: 2, rejectionReason: 'redo' },
    ]);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    const res = await svc.myTasks(vendor());
    expect(res.tasks.find((t: any) => t.id === 't1')!.mySubmission).toEqual({ status: 'REJECTED', version: 2, rejectionReason: 'redo' });
    expect(res.tasks.find((t: any) => t.id === 't2')!.mySubmission).toBeNull();
    // the submission read is pinned to THIS caller's user id
    expect(fns.manualTaskSubmission.findMany.mock.calls[0][0].where.submittedById).toBe('vf1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// submitTask — eligibility, form validation, create vs re-capture, 409s
// ─────────────────────────────────────────────────────────────────────────────
describe('ManualService.submitTask', () => {
  const goodValues = { formValues: { photo: 'posm-media/c1/a.jpg', note: 'ok' } };

  it('records MANUAL photo content-hashes on submit (advisory duplicate signal)', async () => {
    const { prisma, fns } = makePrisma();
    const media = { recordImageHashes: jest.fn().mockResolvedValue({ dupHashes: [] }) } as any;
    const integrity = { fetchImageBytes: jest.fn().mockResolvedValue(Buffer.from('img')), hash: jest.fn().mockReturnValue('H1') } as any;
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue(null); // first submission
    fns.manualTaskSubmission.create.mockResolvedValue({ id: 's1', version: 1 });
    const svc = new ManualService(prisma, media, integrity);
    await svc.submitTask(vendor(), 't1', goodValues as any);
    expect(integrity.fetchImageBytes).toHaveBeenCalledWith('posm-media/c1/a.jpg');
    expect(media.recordImageHashes).toHaveBeenCalledWith(prisma, 'c1', { ownerKind: 'MANUAL', ownerId: 's1' }, ['H1']);
  });

  it('a failing hash-record never blocks the submission (advisory only)', async () => {
    const { prisma, fns } = makePrisma();
    const media = { recordImageHashes: jest.fn().mockRejectedValue(new Error('hash store down')) } as any;
    const integrity = { fetchImageBytes: jest.fn().mockResolvedValue(Buffer.from('img')), hash: jest.fn().mockReturnValue('H1') } as any;
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue(null);
    fns.manualTaskSubmission.create.mockResolvedValue({ id: 's1', version: 1 });
    const svc = new ManualService(prisma, media, integrity);
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).resolves.toMatchObject({ id: 's1' });
  });

  it('FAIL-CLOSED: a vendor token with NO vendorId → 404', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor({ vendorId: undefined }), 't1', goodValues as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.manualTask.findFirst).not.toHaveBeenCalled();
  });

  it('a task not in my tenant / not for my fleet is INVISIBLE → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue(null);
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(NotFoundException);
    const where = fns.manualTask.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ vendorId: null }, { vendorId: 'v1' }]);
    expect(where.clientId).toBe('c1');
  });

  it('a CLOSED task → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'CLOSED', formSchema: validSchema() });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('INVALID formValues (missing required photo) → 400 (delegated to the form engine)', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', { formValues: { note: 'no photo' } } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.manualTaskSubmission.create).not.toHaveBeenCalled();
  });

  it('FIRST submission → create (SUBMITTED, version 1), stamps clientId + vendorId, audit CREATE', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue(null);
    fns.manualTaskSubmission.create.mockResolvedValue({ id: 's1', status: 'SUBMITTED', version: 1 });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.submitTask(vendor(), 't1', goodValues as any);
    const data = fns.manualTaskSubmission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ clientId: 'c1', taskId: 't1', submittedById: 'vf1', vendorId: 'v1', status: 'SUBMITTED', version: 1 });
    // only the projected/validated values are stored (unknown keys dropped by the engine)
    expect(data.formValues).toEqual({ photo: 'posm-media/c1/a.jpg', note: 'ok' });
    expect(fns.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CREATE', entityType: 'MANUAL_SUBMISSION' });
  });

  it('a REJECTED prior → re-capture IN PLACE (version++, SUBMITTED, clears rejection), audit UPDATE', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue({ id: 's1', status: 'REJECTED', version: 1 });
    fns.manualTaskSubmission.update.mockResolvedValue({ id: 's1', status: 'SUBMITTED', version: 2 });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await svc.submitTask(vendor(), 't1', goodValues as any);
    const call = fns.manualTaskSubmission.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1', status: 'REJECTED' });
    expect(call.data).toMatchObject({ status: 'SUBMITTED', version: { increment: 1 }, rejectionReason: null, reviewedById: null, reviewedAt: null });
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('UPDATE');
    expect(fns.manualTaskSubmission.create).not.toHaveBeenCalled();
  });

  it('an already-SUBMITTED prior → 409, never writes', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue({ id: 's1', status: 'SUBMITTED', version: 1 });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(ConflictException);
    expect(fns.manualTaskSubmission.update).not.toHaveBeenCalled();
    expect(fns.manualTaskSubmission.create).not.toHaveBeenCalled();
  });

  it('an already-APPROVED prior → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue({ id: 's1', status: 'APPROVED', version: 1 });
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a concurrent first-create racing @@unique (P2002) → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue(null);
    fns.manualTaskSubmission.create.mockRejectedValue(uniqueError());
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a re-capture whose guarded write matches 0 rows (P2025) → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.manualTask.findFirst.mockResolvedValue({ id: 't1', status: 'OPEN', formSchema: validSchema() });
    fns.manualTaskSubmission.findUnique.mockResolvedValue({ id: 's1', status: 'REJECTED', version: 1 });
    fns.manualTaskSubmission.update.mockRejectedValue(notFoundError());
    const svc = new ManualService(prisma, mediaMock(), integrityMock());
    await expect(svc.submitTask(vendor(), 't1', goodValues as any)).rejects.toBeInstanceOf(ConflictException);
  });
});
