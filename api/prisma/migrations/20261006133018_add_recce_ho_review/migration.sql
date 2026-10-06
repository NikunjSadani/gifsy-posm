-- AlterTable
ALTER TABLE "recces" ADD COLUMN     "hoRejectionReason" TEXT,
ADD COLUMN     "hoRejectionReasonCode" "RejectReasonCode",
ADD COLUMN     "hoReviewStatus" "HoReviewStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "hoReviewedAt" TIMESTAMP(3),
ADD COLUMN     "hoReviewedById" TEXT;

-- CreateIndex
CREATE INDEX "recces_clientId_hoReviewStatus_idx" ON "recces"("clientId", "hoReviewStatus");

-- AddForeignKey
ALTER TABLE "recces" ADD CONSTRAINT "recces_hoReviewedById_fkey" FOREIGN KEY ("hoReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (grandfather): the HO gate is newly inserted between ASM-approve and install. Existing
-- recces that were already ASM-approved (status = 'APPROVED') are treated as HO-approved too, so
-- any in-flight installation is not retroactively blocked by the new gate.
UPDATE "recces" SET "hoReviewStatus" = 'APPROVED' WHERE "status" = 'APPROVED';
