// Unit tests — VendorsService (POSM Wave 1 master).
// Covers: tenant scoping on read (platform-wide OWNER vs pinned tenant), write pins clientId,
// cross-tenant by-id 404, duplicate-code 409, audit rows on every mutation.

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VendorsService } from './vendors.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  vendor: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

const owner = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as any;
const assumedOwner = { ...owner, assumed: true, clientId: 'kwality' } as any;
const clientAdmin = { sub: 'ca1', role: 'CLIENT_ADMIN', clientId: 'kwality', phone: '9', name: 'CA' } as any;

const dupError = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as any);

describe('VendorsService', () => {
  let service: VendorsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VendorsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(VendorsService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  describe('list (tenant scoping)', () => {
    it('un-assumed GIFSY_ADMIN reads platform-wide (no clientId filter)', async () => {
      mockPrisma.vendor.findMany.mockResolvedValue([]);
      await service.list(owner);
      expect(mockPrisma.vendor.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('CLIENT_ADMIN read is pinned to its own tenant', async () => {
      mockPrisma.vendor.findMany.mockResolvedValue([]);
      await service.list(clientAdmin);
      expect(mockPrisma.vendor.findMany.mock.calls[0][0].where).toEqual({ clientId: 'kwality' });
    });

    it('an ASSUMED GIFSY operator is pinned to the assumed tenant (not platform-wide)', async () => {
      mockPrisma.vendor.findMany.mockResolvedValue([]);
      await service.list(assumedOwner);
      expect(mockPrisma.vendor.findMany.mock.calls[0][0].where).toEqual({ clientId: 'kwality' });
    });
  });

  describe('create', () => {
    it('pins clientId to the caller and writes a CREATE audit row', async () => {
      mockPrisma.vendor.create.mockResolvedValue({ id: 'v1', clientId: 'kwality', code: 'V1', name: 'Acme', isActive: true, createdAt: new Date() });
      const res = await service.create(clientAdmin, { code: 'V1', name: 'Acme' });
      expect(mockPrisma.vendor.create.mock.calls[0][0].data.clientId).toBe('kwality');
      expect(res.id).toBe('v1');
      const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'CREATE', entityType: 'VENDOR', entityId: 'v1', actorId: 'ca1' });
    });

    it('a duplicate (clientId, code) surfaces as a 409', async () => {
      mockPrisma.vendor.create.mockRejectedValue(dupError());
      await expect(service.create(clientAdmin, { code: 'V1', name: 'Acme' })).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('get / update / deactivate (by-id scoping)', () => {
    it('404s a vendor id that resolves outside the caller tenant', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue(null);
      await expect(service.get(clientAdmin, 'other')).rejects.toBeInstanceOf(NotFoundException);
      // The lookup carried the tenant filter.
      expect(mockPrisma.vendor.findFirst.mock.calls[0][0].where).toEqual({ id: 'other', clientId: 'kwality' });
    });

    it('deactivate sets isActive=false and writes a DELETE audit row', async () => {
      const existing = { id: 'v1', clientId: 'kwality', code: 'V1', name: 'Acme', isActive: true, createdAt: new Date() };
      mockPrisma.vendor.findFirst.mockResolvedValue(existing);
      mockPrisma.vendor.update.mockResolvedValue({ ...existing, isActive: false });
      await service.deactivate(clientAdmin, 'v1');
      expect(mockPrisma.vendor.update.mock.calls[0][0].data).toEqual({ isActive: false });
      const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'DELETE', entityType: 'VENDOR', entityId: 'v1' });
    });
  });
});
