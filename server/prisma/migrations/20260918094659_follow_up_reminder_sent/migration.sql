ALTER TABLE "LeadFollowUp" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Every follow-up already past its reminder time is marked as done with, so switching the
-- poller on does not fire months of backlog at everybody's phone in one tick.
UPDATE "LeadFollowUp"
   SET "reminderSentAt" = NOW()
 WHERE "reminderAt" IS NOT NULL AND "reminderAt" <= NOW();

CREATE INDEX "LeadFollowUp_reminderSentAt_reminderAt_idx"
    ON "LeadFollowUp"("reminderSentAt", "reminderAt");
