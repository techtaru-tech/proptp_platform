-- CreateTable
CREATE TABLE "AutomationAssignmentCursor" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "dealt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationAssignmentCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationAssignmentCursor_stepId_key" ON "AutomationAssignmentCursor"("stepId");

-- AddForeignKey
ALTER TABLE "AutomationAssignmentCursor" ADD CONSTRAINT "AutomationAssignmentCursor_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AutomationStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
