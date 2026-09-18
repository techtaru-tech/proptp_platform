-- Saving an automation deletes and recreates every step, so a cursor keyed on the step id
-- restarted the rota from the top whenever somebody edited the automation. Keyed on the
-- automation and the step's position instead, it survives the rewrite.
DROP TABLE "AutomationAssignmentCursor";

CREATE TABLE "AutomationAssignmentCursor" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "dealt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationAssignmentCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationAssignmentCursor_automationId_stepIndex_key"
    ON "AutomationAssignmentCursor"("automationId", "stepIndex");

ALTER TABLE "AutomationAssignmentCursor"
    ADD CONSTRAINT "AutomationAssignmentCursor_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
