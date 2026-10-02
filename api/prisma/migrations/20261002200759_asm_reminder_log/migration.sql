-- CreateTable
CREATE TABLE "asm_reminder_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "asmUserId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemCount" INTEGER NOT NULL,

    CONSTRAINT "asm_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asm_reminder_logs_clientId_idx" ON "asm_reminder_logs"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "asm_reminder_logs_clientId_asmUserId_periodKey_key" ON "asm_reminder_logs"("clientId", "asmUserId", "periodKey");

