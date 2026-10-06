-- DropForeignKey
ALTER TABLE "Camera" DROP CONSTRAINT "Camera_ownerId_fkey";

-- AlterTable
ALTER TABLE "Camera" DROP COLUMN "ownerId";

