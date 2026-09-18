-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "receivedOutsideBusinessHours" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BusinessHoursSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "schedule" JSONB NOT NULL,
    "closedMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHoursSettings_pkey" PRIMARY KEY ("id")
);
