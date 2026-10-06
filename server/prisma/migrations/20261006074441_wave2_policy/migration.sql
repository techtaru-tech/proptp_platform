-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "changes" JSONB;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SalesPolicy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "penaltyType" TEXT NOT NULL DEFAULT 'percent',
    "penaltyRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "penaltyPeriod" TEXT NOT NULL DEFAULT 'month',
    "penaltyGraceDays" INTEGER NOT NULL DEFAULT 7,
    "penaltyCapPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "refundDeductionPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "refundApprover" TEXT NOT NULL DEFAULT 'admin',
    "showTokenStage" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCancellation" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "deductionPercent" DOUBLE PRECISION NOT NULL,
    "deductionAmount" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReference" TEXT,

    CONSTRAINT "BookingCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingCancellation_bookingId_key" ON "BookingCancellation"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCancellation_status_idx" ON "BookingCancellation"("status");

-- AddForeignKey
ALTER TABLE "BookingCancellation" ADD CONSTRAINT "BookingCancellation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
