/*
  Warnings:

  - You are about to drop the column `fromUserName` on the `LeadAssignmentHistoryEntry` table. All the data in the column will be lost.
  - You are about to drop the column `toUserName` on the `LeadAssignmentHistoryEntry` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LeadAssignmentHistoryEntry" DROP COLUMN "fromUserName",
DROP COLUMN "toUserName",
ADD COLUMN     "fromUserId" TEXT,
ADD COLUMN     "toUserId" TEXT;

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "assignMode" TEXT NOT NULL,
    "assignUserIds" JSONB,
    "assignTeamId" TEXT,
    "overwrite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "automationName" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_idx" ON "AutomationRun"("automationId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistoryEntry_toUserId_idx" ON "LeadAssignmentHistoryEntry"("toUserId");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
