-- CreateTable
CREATE TABLE "WhatsAppDrip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnWon" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppDrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppDripStep" (
    "id" TEXT NOT NULL,
    "dripId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "params" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headerMediaUrl" TEXT,

    CONSTRAINT "WhatsAppDripStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppDripEnrollment" (
    "id" TEXT NOT NULL,
    "dripId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppDripEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppDripSend" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "templateName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppDripSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppDrip_status_idx" ON "WhatsAppDrip"("status");

-- CreateIndex
CREATE INDEX "WhatsAppDripStep_dripId_sortOrder_idx" ON "WhatsAppDripStep"("dripId", "sortOrder");

-- CreateIndex
CREATE INDEX "WhatsAppDripEnrollment_status_nextSendAt_idx" ON "WhatsAppDripEnrollment"("status", "nextSendAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppDripEnrollment_dripId_leadId_key" ON "WhatsAppDripEnrollment"("dripId", "leadId");

-- CreateIndex
CREATE INDEX "WhatsAppDripSend_enrollmentId_idx" ON "WhatsAppDripSend"("enrollmentId");

-- AddForeignKey
ALTER TABLE "WhatsAppDripStep" ADD CONSTRAINT "WhatsAppDripStep_dripId_fkey" FOREIGN KEY ("dripId") REFERENCES "WhatsAppDrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDripEnrollment" ADD CONSTRAINT "WhatsAppDripEnrollment_dripId_fkey" FOREIGN KEY ("dripId") REFERENCES "WhatsAppDrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDripEnrollment" ADD CONSTRAINT "WhatsAppDripEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDripSend" ADD CONSTRAINT "WhatsAppDripSend_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "WhatsAppDripEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDripSend" ADD CONSTRAINT "WhatsAppDripSend_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WhatsAppDripStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

