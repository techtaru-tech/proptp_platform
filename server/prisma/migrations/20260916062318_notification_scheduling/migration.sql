-- AlterEnum
ALTER TYPE "NotificationAudience" ADD VALUE 'custom';

-- AlterEnum
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'scheduled';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3);
