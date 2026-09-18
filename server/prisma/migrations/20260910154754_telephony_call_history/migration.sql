-- AlterTable
ALTER TABLE "User" ADD COLUMN     "callExtension" TEXT;

-- CreateTable
CREATE TABLE "TelephonySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'airphone',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://airphone.in/api',
    "apiToken" TEXT,
    "virtualNumber" TEXT,
    "webhookToken" TEXT NOT NULL,
    "fallbackNumber" TEXT,
    "stickyRouting" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelephonySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "uniqueId" TEXT,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'incoming',
    "status" TEXT NOT NULL DEFAULT 'routing',
    "callerNumber" TEXT NOT NULL,
    "agentNumber" TEXT,
    "virtualNumber" TEXT,
    "leadId" TEXT,
    "agentUserId" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "recordingUrl" TEXT,
    "recordingDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "dtmf" TEXT,
    "feedback" TEXT,
    "rawPayload" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelephonySettings_webhookToken_key" ON "TelephonySettings"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_uniqueId_key" ON "CallLog"("uniqueId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_requestId_key" ON "CallLog"("requestId");

-- CreateIndex
CREATE INDEX "CallLog_leadId_idx" ON "CallLog"("leadId");

-- CreateIndex
CREATE INDEX "CallLog_agentUserId_idx" ON "CallLog"("agentUserId");

-- CreateIndex
CREATE INDEX "CallLog_status_idx" ON "CallLog"("status");

-- CreateIndex
CREATE INDEX "CallLog_startedAt_idx" ON "CallLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_callExtension_key" ON "User"("callExtension");

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

