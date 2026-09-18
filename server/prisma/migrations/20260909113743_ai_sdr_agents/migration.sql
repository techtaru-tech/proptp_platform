-- CreateTable
CREATE TABLE "AiSdrAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "goal" TEXT NOT NULL DEFAULT 'qualify_lead',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "persona" TEXT,
    "offerContext" TEXT,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 4,
    "minHoursBetweenFollowUps" INTEGER NOT NULL DEFAULT 24,
    "respectBusinessHours" BOOLEAN NOT NULL DEFAULT true,
    "handoffUserId" TEXT,
    "meetingType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSdrAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSdrEnrollment" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "followUpsSent" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "nextEligibleAt" TIMESTAMP(3),
    "handedOffAt" TIMESTAMP(3),
    "handedOffToUserId" TEXT,
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSdrEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSdrMessage" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'human',
    "status" TEXT NOT NULL DEFAULT 'logged',
    "deliveryNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSdrMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSdrEnrollment_status_nextEligibleAt_idx" ON "AiSdrEnrollment"("status", "nextEligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSdrEnrollment_agentId_leadId_key" ON "AiSdrEnrollment"("agentId", "leadId");

-- CreateIndex
CREATE INDEX "AiSdrMessage_enrollmentId_idx" ON "AiSdrMessage"("enrollmentId");

-- AddForeignKey
ALTER TABLE "AiSdrEnrollment" ADD CONSTRAINT "AiSdrEnrollment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiSdrAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSdrEnrollment" ADD CONSTRAINT "AiSdrEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSdrMessage" ADD CONSTRAINT "AiSdrMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AiSdrEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
