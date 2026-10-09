-- CreateEnum
CREATE TYPE "RecceMode" AS ENUM ('APP', 'MANUAL');

-- DropIndex: the old hard "one recce per outlet" unique is replaced by the APP-only partial unique below.
DROP INDEX "recces_clientId_siteId_key";

-- AlterTable: existing rows default to APP, preserving one-recce-per-outlet for them.
ALTER TABLE "recces" ADD COLUMN     "recceMode" "RecceMode" NOT NULL DEFAULT 'APP';

-- CreateIndex: plain covering index for the (clientId, siteId) lookups that remain.
CREATE INDEX "recces_clientId_siteId_idx" ON "recces"("clientId", "siteId");

-- CreateIndex: APP-only uniqueness — one live APP recce per outlet; MANUAL recces are unlimited.
-- Prisma can't express a partial unique index in the schema block, so it is declared here (and is
-- documented on the Recce model). The WHERE clause scopes the constraint to APP recces only.
CREATE UNIQUE INDEX "recces_app_one_per_site" ON "recces"("clientId", "siteId") WHERE "recceMode" = 'APP';
