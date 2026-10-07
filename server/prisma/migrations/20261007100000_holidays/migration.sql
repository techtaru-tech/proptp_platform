-- Company holidays. One row per occasion, with an inclusive date range, so Diwali is one
-- holiday running three days rather than three holidays that have to be kept in step.
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'festival',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- Every read is "the holidays in this year" or "the next one coming up", both of which are
-- range scans on the start date.
CREATE INDEX "Holiday_startDate_idx" ON "Holiday"("startDate");
