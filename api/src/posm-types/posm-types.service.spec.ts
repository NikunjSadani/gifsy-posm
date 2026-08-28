// Unit tests — PosmTypesService (POSM Wave 1 master).
// Covers: tenant scoping on read, write pins clientId, cross-tenant by-id 404,
// duplicate-code 409, audit rows on every mutation.

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PosmTypesService } from './posm-types.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  posmType: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

const owner = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as any;
const clientAdmin = { sub: 'ca1', role: 'CLIENT_ADMIN', clientId: 'kwality', phone: '9', name: 'CA' } as any;

const dupError = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as any);

describe('PosmTypesService', () => {
  let service: PosmTypesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PosmTypesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(PosmTypesService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  describe('list (tenant scoping)', () => {
    it('un-assumed GIFSY_ADMIN reads platform-wide (no clientId filter)', async () => {
      mockPrisma.posmType.findMany.mockResolvedValue([]);
      await service.list(owner);
      expect(mockPrisma.posmType.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('CLIENT_ADMIN read is pinned to its own tenant', async () => {
      mockPrisma.posmType.findMany.mockResolvedValue([]);
      await service.list(clientAdmin);
      expect(mockPrisma.posmType.findMany.mock.calls[0][0].where).toEqual({ clientId: 'kwality' });
    });
  });

  describe('create', () => {
    it('pins clientId, persists defaultDimensions, writes a CREATE audit row', async () => {
      mockPrisma.posmType.create.mockResolvedValue({ id: 'p1', clientId: 'kwality', code: 'STD', name: 'Standee', isActive: true });
      await service.create(clientAdmin, { code: 'STD', name: 'Standee', defaultDimensions: { width: 2, height: 3, unit: 'ft' } });
      const data = mockPrisma.posmType.create.mock.calls[0][0].data;
      expect(data.clientId).toBe('kwality');
      expect(data.defaultDimensions).toEqual({ width: 2, height: 3, unit: 'ft' });
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CREATE', entityType: 'POSM_TYPE', entityId: 'p1' });
    });

    it('a duplicate (clientId, code) surfaces as a 409', async () => {
      mockPrisma.posmType.create.mockRejectedValue(dupError());
      await expect(service.create(clientAdmin, { code: 'STD', name: 'Standee' })).rejects.toBeInstanceOf(ConflictException);
    });

    // F8 — an un-assumed GIFSY_ADMIN has no tenant context → cannot create tenant data.
    it('rejects create from an un-assumed GIFSY_ADMIN (400), never touching the DB', async () => {
      await expect(service.create(owner, { code: 'STD', name: 'Standee' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.posmType.create).not.toHaveBeenCalled();
    });

    it('ALLOWS create from an ASSUMED GIFSY operator', async () => {
      const assumedOwner = { ...owner, assumed: true, clientId: 'kwality' } as any;
      mockPrisma.posmType.create.mockResolvedValue({ id: 'p1', clientId: 'kwality', code: 'STD', name: 'Standee', isActive: true });
      await service.create(assumedOwner, { code: 'STD', name: 'Standee' });
      expect(mockPrisma.posmType.create).toHaveBeenCalled();
    });
  });

  describe('by-id scoping', () => {
    it('404s an id outside the caller tenant, with the tenant filter applied', async () => {
      mockPrisma.posmType.findFirst.mockResolvedValue(null);
      await expect(service.get(clientAdmin, 'other')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.posmType.findFirst.mock.calls[0][0].where).toEqual({ id: 'other', clientId: 'kwality' });
    });

    it('deactivate sets isActive=false and audits DELETE', async () => {
      const existing = { id: 'p1', clientId: 'kwality', code: 'STD', name: 'Standee', isActive: true };
      mockPrisma.posmType.findFirst.mockResolvedValue(existing);
      mockPrisma.posmType.update.mockResolvedValue({ ...existing, isActive: false });
      await service.deactivate(clientAdmin, 'p1');
      expect(mockPrisma.posmType.update.mock.calls[0][0].data).toEqual({ isActive: false });
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'DELETE', entityType: 'POSM_TYPE', entityId: 'p1' });
    });
  });
});
