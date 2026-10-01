-- AlterTable
ALTER TABLE "LegalFile" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OpsRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsRuleFire" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "occurrence" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsRuleFire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsRuleFire_ruleId_firedAt_idx" ON "OpsRuleFire"("ruleId", "firedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpsRuleFire_ruleId_subjectKey_stepIndex_occurrence_key" ON "OpsRuleFire"("ruleId", "subjectKey", "stepIndex", "occurrence");

-- AddForeignKey
ALTER TABLE "OpsRuleFire" ADD CONSTRAINT "OpsRuleFire_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "OpsRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
