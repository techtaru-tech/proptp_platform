-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "pointsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pointsPerRupee" DOUBLE PRECISION NOT NULL DEFAULT 10;

