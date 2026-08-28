// Unit tests — UsersService (POSM Wave 1 identity/provisioning).
// Covers: tenant scoping on read; the vendor-role-must-have-vendorId / non-vendor-must-not
// invariant on BOTH create and update; duplicate-phone 409; and deactivate calling
// AuthService.invalidateAllSessions (immediate eviction of a disabled login).

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  vendor: { findFirst: jest.fn() },
  auditLog: { create: jest.fn() },
};

const mockAuth = { invalidateAllSessions: jest.fn() };

const owner = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as any;
const clientAdmin = { sub: 'ca1', role: 'CLIENT_ADMIN', clientId: 'kwality', phone: '9', name: 'CA' } as any;

const dupError = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' } as any);

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthService, useValue: mockAuth },
      ],
    }).compile();
    service = module.get(UsersService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockAuth.invalidateAllSessions.mockResolvedValue(2);
  });

  describe('list (tenant scoping)', () => {
    it('platform-wide for un-assumed OWNER, but always excludes GIFSY_ADMIN rows', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.list(owner);
      expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({ role: { not: 'GIFSY_ADMIN' } });
    });

    it('pins to the caller tenant for CLIENT_ADMIN', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.list(clientAdmin);
      expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({ clientId: 'kwality', role: { not: 'GIFSY_ADMIN' } });
    });
  });

  describe('create — vendor-linkage invariant', () => {
    it('rejects a VENDOR_FIELD user with NO vendorId (400)', async () => {
      await expect(
        service.create(clientAdmin, { phone: '9876543210', name: 'F', role: 'VENDOR_FIELD' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a VENDOR_HO user whose vendorId is not in the tenant (400)', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue(null); // vendor not found in tenant
      await expect(
        service.create(clientAdmin, { phone: '9876543210', name: 'H', role: 'VENDOR_HO', vendorId: 'ven-x' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.vendor.findFirst.mock.calls[0][0].where).toEqual({ id: 'ven-x', clientId: 'kwality' });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a non-vendor role (ASM) that carries a vendorId (400)', async () => {
      await expect(
        service.create(clientAdmin, { phone: '9876543210', name: 'A', role: 'ASM', vendorId: 'ven1' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a VENDOR_FIELD user tied to a valid tenant vendor + pins clientId + audits', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'ven1' });
      mockPrisma.user.create.mockResolvedValue({ id: 'u1', clientId: 'kwality', phone: '9876543210', name: 'F', role: 'VENDOR_FIELD', vendorId: 'ven1', isActive: true, createdAt: new Date(), updatedAt: new Date() });
      const res = await service.create(clientAdmin, { phone: '9876543210', name: 'F', role: 'VENDOR_FIELD', vendorId: 'ven1' } as any);
      expect(mockPrisma.user.create.mock.calls[0][0].data).toMatchObject({ clientId: 'kwality', vendorId: 'ven1', role: 'VENDOR_FIELD' });
      expect(res.id).toBe('u1');
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CREATE', entityType: 'USER', entityId: 'u1' });
    });

    it('creates a plain ASM user with no vendorId', async () => {
      mockPrisma.user.create.mockResolvedValue({ id: 'u2', clientId: 'kwality', role: 'ASM', vendorId: null, isActive: true, createdAt: new Date(), updatedAt: new Date() });
      await service.create(clientAdmin, { phone: '9876500000', name: 'A', role: 'ASM' } as any);
      expect(mockPrisma.user.create.mock.calls[0][0].data.vendorId).toBeNull();
      expect(mockPrisma.vendor.findFirst).not.toHaveBeenCalled();
    });

    it('a duplicate (clientId, phone) surfaces as 409', async () => {
      mockPrisma.user.create.mockRejectedValue(dupError());
      await expect(
        service.create(clientAdmin, { phone: '9876543210', name: 'A', role: 'ASM' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update — invariant re-checked against the resulting role', () => {
    const existingVendorUser = { id: 'u1', clientId: 'kwality', phone: '9876543210', name: 'F', role: 'VENDOR_FIELD', vendorId: 'ven1', isActive: true, createdAt: new Date(), updatedAt: new Date() };

    it('rejects flipping a VENDOR_FIELD to ASM without clearing vendorId (400)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingVendorUser);
      await expect(service.update(clientAdmin, 'u1', { role: 'ASM' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows flipping VENDOR_FIELD → ASM when vendorId is cleared (null)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingVendorUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingVendorUser, role: 'ASM', vendorId: null });
      await service.update(clientAdmin, 'u1', { role: 'ASM', vendorId: null });
      expect(mockPrisma.user.update.mock.calls[0][0].data).toMatchObject({ role: 'ASM', vendorId: null });
    });

    it('deactivate via update (isActive=false) also evicts sessions', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingVendorUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingVendorUser, isActive: false });
      await service.update(clientAdmin, 'u1', { isActive: false });
      expect(mockAuth.invalidateAllSessions).toHaveBeenCalledWith('u1');
    });
  });

  describe('deactivate', () => {
    it('sets isActive=false, audits DELETE, and evicts ALL sessions immediately', async () => {
      const existing = { id: 'u1', clientId: 'kwality', phone: '9876543210', name: 'F', role: 'ASM', vendorId: null, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.user.findFirst.mockResolvedValue(existing);
      mockPrisma.user.update.mockResolvedValue({ ...existing, isActive: false });

      await service.deactivate(clientAdmin, 'u1');

      expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({ isActive: false });
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'DELETE', entityType: 'USER', entityId: 'u1' });
      // The eviction wiring MUST fire.
      expect(mockAuth.invalidateAllSessions).toHaveBeenCalledWith('u1');
    });

    it('404s an id outside the caller tenant (never touches sessions)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.deactivate(clientAdmin, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockAuth.invalidateAllSessions).not.toHaveBeenCalled();
    });
  });
});
