-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('hot', 'warm', 'cold');

-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show');

-- AlterEnum
ALTER TYPE "LegalDocKind" ADD VALUE 'cost_sheet';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "interestedProjectId" TEXT,
ADD COLUMN     "originalSource" TEXT,
ADD COLUMN     "temperature" "LeadTemperature";

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'scheduled',
    "hostId" TEXT,
    "visitorCount" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "interest" "LeadTemperature",
    "feedback" TEXT,
    "nextAction" TEXT,
    "cancelReason" TEXT,
    "reminderId" TEXT,
    "followUpId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisit_leadId_idx" ON "SiteVisit"("leadId");

-- CreateIndex
CREATE INDEX "SiteVisit_scheduledAt_status_idx" ON "SiteVisit"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "SiteVisit_hostId_idx" ON "SiteVisit"("hostId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_interestedProjectId_fkey" FOREIGN KEY ("interestedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The first source of every existing lead is the source it has now.
UPDATE "Lead" SET "originalSource" = "source" WHERE "originalSource" IS NULL;
