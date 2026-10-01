-- CreateEnum
CREATE TYPE "ProgressReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "SiteIssueStatus" AS ENUM ('open', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "ConstructionActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT '',
    "block" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressUpdate" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "workDone" TEXT NOT NULL,
    "manpower" INTEGER NOT NULL DEFAULT 0,
    "percentComplete" INTEGER NOT NULL,
    "remarks" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "status" "ProgressReviewStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "raisedById" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "SiteIssueStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProgressMessage" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerProgressMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConstructionActivity_projectId_idx" ON "ConstructionActivity"("projectId");

-- CreateIndex
CREATE INDEX "ConstructionActivity_assigneeId_idx" ON "ConstructionActivity"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressUpdate_clientId_key" ON "ProgressUpdate"("clientId");

-- CreateIndex
CREATE INDEX "ProgressUpdate_activityId_status_idx" ON "ProgressUpdate"("activityId", "status");

-- CreateIndex
CREATE INDEX "ProgressUpdate_authorId_idx" ON "ProgressUpdate"("authorId");

-- CreateIndex
CREATE INDEX "ProgressPhoto_updateId_idx" ON "ProgressPhoto"("updateId");

-- CreateIndex
CREATE INDEX "SiteIssue_projectId_status_idx" ON "SiteIssue"("projectId", "status");

-- CreateIndex
CREATE INDEX "SiteIssue_ownerId_idx" ON "SiteIssue"("ownerId");

-- CreateIndex
CREATE INDEX "BuyerProgressMessage_bookingId_idx" ON "BuyerProgressMessage"("bookingId");

-- AddForeignKey
ALTER TABLE "ConstructionActivity" ADD CONSTRAINT "ConstructionActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionActivity" ADD CONSTRAINT "ConstructionActivity_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ConstructionActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressPhoto" ADD CONSTRAINT "ProgressPhoto_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "ProgressUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ConstructionActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
