/*
  Warnings:

  - You are about to drop the column `attendanceReminders` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `bookingAlerts` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `emailEnabled` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `payoutAlerts` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `pushEnabled` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `smsEnabled` on the `NotificationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `gstNumber` on the `OrganizationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `supportEmail` on the `OrganizationSettings` table. All the data in the column will be lost.
  - You are about to drop the column `supportPhone` on the `OrganizationSettings` table. All the data in the column will be lost.
  - Made the column `logoUrl` on table `OrganizationSettings` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "NotificationSettings" DROP COLUMN "attendanceReminders",
DROP COLUMN "bookingAlerts",
DROP COLUMN "emailEnabled",
DROP COLUMN "payoutAlerts",
DROP COLUMN "pushEnabled",
DROP COLUMN "smsEnabled",
ADD COLUMN     "dailySummary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticketAlerts" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OrganizationSettings" DROP COLUMN "gstNumber",
DROP COLUMN "supportEmail",
DROP COLUMN "supportPhone",
ADD COLUMN     "contactEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactPhone" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "companyName" SET DEFAULT 'Shree Ram Group',
ALTER COLUMN "logoUrl" SET NOT NULL,
ALTER COLUMN "logoUrl" SET DEFAULT '';
