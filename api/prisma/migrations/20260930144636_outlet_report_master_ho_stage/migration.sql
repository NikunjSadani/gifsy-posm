-- CreateEnum
CREATE TYPE "HoReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "installations" ADD COLUMN     "hoRejectionReason" TEXT,
ADD COLUMN     "hoReviewStatus" "HoReviewStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "hoReviewedAt" TIMESTAMP(3),
ADD COLUMN     "hoReviewedById" TEXT,
ADD COLUMN     "isDirect" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "address" TEXT,
ADD COLUMN     "beatName" TEXT,
ADD COLUMN     "channel" TEXT,
ADD COLUMN     "cluster" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "promoterCode" TEXT;

-- CreateIndex
CREATE INDEX "installations_clientId_hoReviewStatus_idx" ON "installations"("clientId", "hoReviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "users_clientId_promoterCode_key" ON "users"("clientId", "promoterCode");

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_hoReviewedById_fkey" FOREIGN KEY ("hoReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

