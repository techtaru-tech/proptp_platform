/*
  Warnings:

  - Added the required column `updatedAt` to the `AutomationRun` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "description" TEXT,
ADD COLUMN     "respectBusinessHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "triggerConfig" JSONB,
ALTER COLUMN "conditions" DROP NOT NULL,
ALTER COLUMN "conditions" DROP DEFAULT,
ALTER COLUMN "assignMode" DROP NOT NULL,
ALTER COLUMN "overwrite" DROP NOT NULL,
ALTER COLUMN "overwrite" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "nextStepIndex" INTEGER,
ADD COLUMN     "resumeAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "AutomationStep" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,

    CONSTRAINT "AutomationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationStep_automationId_idx" ON "AutomationStep"("automationId");

-- CreateIndex
CREATE INDEX "AutomationRun_status_resumeAt_idx" ON "AutomationRun"("status", "resumeAt");

-- AddForeignKey
ALTER TABLE "AutomationStep" ADD CONSTRAINT "AutomationStep_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
