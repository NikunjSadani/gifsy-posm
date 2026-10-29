-- CreateEnum
CREATE TYPE "ElementMeasurement" AS ENUM ('DIMENSION', 'UNIT');

-- AlterTable
ALTER TABLE "posm_types" ADD COLUMN     "isGsb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAreaSqFt" DOUBLE PRECISION,
ADD COLUMN     "measurement" "ElementMeasurement" NOT NULL DEFAULT 'DIMENSION';

-- Data back-fill: flag the existing GSB element so the recce GSB gate keys on PosmType.isGsb
-- instead of the hardcoded code==='GSB' rule (same outlets remain GSB-gated after cutover).
UPDATE "posm_types" SET "isGsb" = true WHERE upper("code") = 'GSB';
