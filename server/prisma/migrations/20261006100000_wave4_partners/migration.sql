-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "partnerId" TEXT;

-- AlterTable
ALTER TABLE "SalesPolicy" ADD COLUMN     "brokerageEligibleAt" TEXT NOT NULL DEFAULT 'booking',
ADD COLUMN     "brokerageTdsPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "leadProtectionDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authorisedProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PartnerDispute" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "leadId" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "raisedByName" TEXT NOT NULL,
    "resolvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerDispute_partnerId_status_idx" ON "PartnerDispute"("partnerId", "status");

-- CreateIndex
CREATE INDEX "Lead_partnerId_idx" ON "Lead"("partnerId");

