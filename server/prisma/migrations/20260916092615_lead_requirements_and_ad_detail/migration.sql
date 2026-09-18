-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "adDetail" JSONB,
ADD COLUMN     "budgetRange" TEXT,
ADD COLUMN     "preferredLocation" TEXT,
ADD COLUMN     "propertyType" TEXT,
ADD COLUMN     "purpose" TEXT;
