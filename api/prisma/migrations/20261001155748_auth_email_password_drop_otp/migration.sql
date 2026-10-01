-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT,
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

-- DropTable
DROP TABLE "otp_codes";

-- DropEnum
DROP TYPE "OtpChannel";

-- DropEnum
DROP TYPE "OtpPurpose";

-- CreateIndex
CREATE UNIQUE INDEX "users_clientId_email_key" ON "users"("clientId", "email");

