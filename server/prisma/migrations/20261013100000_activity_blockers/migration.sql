-- CreateEnum
CREATE TYPE "BlockerStatus" AS ENUM ('pending', 'approved', 'rejected', 'resolved');

-- CreateTable
CREATE TABLE "ActivityBlocker" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "clientId" TEXT,
    "status" "BlockerStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBlocker_clientId_key" ON "ActivityBlocker"("clientId");

-- CreateIndex
CREATE INDEX "ActivityBlocker_activityId_status_idx" ON "ActivityBlocker"("activityId", "status");

-- CreateIndex
CREATE INDEX "ActivityBlocker_raisedById_idx" ON "ActivityBlocker"("raisedById");

-- AddForeignKey
ALTER TABLE "ActivityBlocker" ADD CONSTRAINT "ActivityBlocker_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ConstructionActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBlocker" ADD CONSTRAINT "ActivityBlocker_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBlocker" ADD CONSTRAINT "ActivityBlocker_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

