-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('GIFSY_ADMIN', 'CLIENT_ADMIN', 'ASM', 'AUDITOR', 'VENDOR_HO', 'VENDOR_FIELD');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RecceStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('SUBMITTED', 'AUDIT_APPROVED', 'AUDIT_REJECTED');

-- CreateEnum
CREATE TYPE "RejectReasonCode" AS ENUM ('BLURRY', 'WRONG_SITE', 'POSM_NOT_VISIBLE', 'GEO_MISMATCH', 'DUPLICATE_PHOTO', 'WRONG_POSM', 'DIMENSIONS_MISMATCH', 'OTHER');

-- CreateEnum
CREATE TYPE "ManualTaskStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "branding" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "vendorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionsInvalidBefore" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "rotatedFromId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "clientId" TEXT,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'LOGIN',
    "channel" "OtpChannel",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "lat" DECIMAL(10,8),
    "lng" DECIMAL(11,8),
    "town" TEXT,
    "rsCode" TEXT,
    "vendorId" TEXT,
    "asmUserId" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posm_types" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDimensions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "posm_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recces" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "status" "RecceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "captureLat" DECIMAL(10,8),
    "captureLng" DECIMAL(11,8),
    "captureAccuracy" INTEGER,
    "distanceMeters" DECIMAL(10,2),
    "geoFenceOk" BOOLEAN,
    "capturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReasonCode" "RejectReasonCode",
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recce_posms" (
    "id" TEXT NOT NULL,
    "recceId" TEXT NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "posmTypeId" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "photo" JSONB NOT NULL,
    "markup" JSONB,

    CONSTRAINT "recce_posms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "recceId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "status" "InstallationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "capturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditedById" TEXT,
    "auditedAt" TIMESTAMP(3),
    "rejectionReasonCode" "RejectReasonCode",
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "install_posms" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "reccePosmId" TEXT NOT NULL,
    "photo" JSONB NOT NULL,
    "captureLat" DECIMAL(10,8),
    "captureLng" DECIMAL(11,8),
    "geoFenceOk" BOOLEAN,
    "distanceFromRecce" DECIMAL(10,2),
    "beforeAfterDiffOk" BOOLEAN,
    "qualityFlags" JSONB,

    CONSTRAINT "install_posms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_hashes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_hashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_tasks" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "formSchema" JSONB NOT NULL,
    "vendorId" TEXT,
    "status" "ManualTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_task_submissions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "formValues" JSONB NOT NULL,
    "status" "ManualTaskStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedById" TEXT,
    "rejectionReasonCode" "RejectReasonCode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_task_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- CreateIndex
CREATE INDEX "users_clientId_role_idx" ON "users"("clientId", "role");

-- CreateIndex
CREATE INDEX "users_vendorId_idx" ON "users"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "users_clientId_phone_key" ON "users"("clientId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes"("phone");

-- CreateIndex
CREATE INDEX "otp_codes_clientId_idx" ON "otp_codes"("clientId");

-- CreateIndex
CREATE INDEX "otp_codes_purpose_idx" ON "otp_codes"("purpose");

-- CreateIndex
CREATE INDEX "otp_codes_expiresAt_idx" ON "otp_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_clientId_code_key" ON "vendors"("clientId", "code");

-- CreateIndex
CREATE INDEX "sites_clientId_vendorId_idx" ON "sites"("clientId", "vendorId");

-- CreateIndex
CREATE INDEX "sites_clientId_asmUserId_idx" ON "sites"("clientId", "asmUserId");

-- CreateIndex
CREATE INDEX "sites_clientId_town_idx" ON "sites"("clientId", "town");

-- CreateIndex
CREATE UNIQUE INDEX "sites_clientId_code_key" ON "sites"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "posm_types_clientId_code_key" ON "posm_types"("clientId", "code");

-- CreateIndex
CREATE INDEX "recces_clientId_status_idx" ON "recces"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recces_clientId_siteId_key" ON "recces"("clientId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "recce_posms_recceId_slotNo_key" ON "recce_posms"("recceId", "slotNo");

-- CreateIndex
CREATE UNIQUE INDEX "installations_recceId_key" ON "installations"("recceId");

-- CreateIndex
CREATE INDEX "installations_clientId_status_idx" ON "installations"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "install_posms_reccePosmId_key" ON "install_posms"("reccePosmId");

-- CreateIndex
CREATE INDEX "image_hashes_clientId_hash_idx" ON "image_hashes"("clientId", "hash");

-- CreateIndex
CREATE INDEX "image_hashes_ownerKind_ownerId_idx" ON "image_hashes"("ownerKind", "ownerId");

-- CreateIndex
CREATE INDEX "manual_tasks_clientId_status_idx" ON "manual_tasks"("clientId", "status");

-- CreateIndex
CREATE INDEX "manual_task_submissions_taskId_idx" ON "manual_task_submissions"("taskId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_asmUserId_fkey" FOREIGN KEY ("asmUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posm_types" ADD CONSTRAINT "posm_types_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recces" ADD CONSTRAINT "recces_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recces" ADD CONSTRAINT "recces_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recces" ADD CONSTRAINT "recces_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recces" ADD CONSTRAINT "recces_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recce_posms" ADD CONSTRAINT "recce_posms_recceId_fkey" FOREIGN KEY ("recceId") REFERENCES "recces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recce_posms" ADD CONSTRAINT "recce_posms_posmTypeId_fkey" FOREIGN KEY ("posmTypeId") REFERENCES "posm_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_recceId_fkey" FOREIGN KEY ("recceId") REFERENCES "recces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_auditedById_fkey" FOREIGN KEY ("auditedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_posms" ADD CONSTRAINT "install_posms_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_posms" ADD CONSTRAINT "install_posms_reccePosmId_fkey" FOREIGN KEY ("reccePosmId") REFERENCES "recce_posms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_task_submissions" ADD CONSTRAINT "manual_task_submissions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "manual_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
