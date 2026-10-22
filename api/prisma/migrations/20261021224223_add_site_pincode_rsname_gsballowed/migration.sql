-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "gsbAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "rsName" TEXT;
