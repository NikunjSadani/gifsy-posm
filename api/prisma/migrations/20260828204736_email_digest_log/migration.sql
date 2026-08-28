-- CreateTable
CREATE TABLE "email_digest_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "digestType" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "email_digest_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_digest_logs_clientId_idx" ON "email_digest_logs"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "email_digest_logs_clientId_digestType_forDate_key" ON "email_digest_logs"("clientId", "digestType", "forDate");

