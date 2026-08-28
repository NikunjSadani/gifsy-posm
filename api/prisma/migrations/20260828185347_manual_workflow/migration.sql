-- CreateEnum
CREATE TYPE "ManualTaskState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ManualSubmissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "manual_task_submissions" DROP COLUMN "rejectionReasonCode",
ADD COLUMN     "clientId" TEXT NOT NULL,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vendorId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
DROP COLUMN "status",
ADD COLUMN     "status" "ManualSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED';

-- AlterTable
ALTER TABLE "manual_tasks" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "ManualTaskState" NOT NULL DEFAULT 'OPEN';

-- DropEnum
DROP TYPE "ManualTaskStatus";

-- CreateIndex
CREATE INDEX "manual_task_submissions_clientId_status_idx" ON "manual_task_submissions"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "manual_task_submissions_taskId_submittedById_key" ON "manual_task_submissions"("taskId", "submittedById");

-- CreateIndex
CREATE INDEX "manual_tasks_clientId_status_idx" ON "manual_tasks"("clientId", "status");

-- CreateIndex
CREATE INDEX "manual_tasks_clientId_vendorId_idx" ON "manual_tasks"("clientId", "vendorId");

