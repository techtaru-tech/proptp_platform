-- AlterTable
ALTER TABLE "TelephonySettings" ADD COLUMN     "testRouteNumber" TEXT;

-- CreateTable
CREATE TABLE "TelephonyEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "errorMessage" TEXT,
    "callLogId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelephonyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelephonyEvent_receivedAt_idx" ON "TelephonyEvent"("receivedAt");
