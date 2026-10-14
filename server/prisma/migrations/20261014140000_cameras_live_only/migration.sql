-- DropForeignKey
ALTER TABLE "CameraImage" DROP CONSTRAINT "CameraImage_cameraId_fkey";

-- DropIndex
DROP INDEX "Camera_keyHash_key";

-- AlterTable
ALTER TABLE "Camera" DROP COLUMN "expectedEveryMinutes",
DROP COLUMN "keyHash",
DROP COLUMN "keyPrefix",
DROP COLUMN "lastImageAt",
DROP COLUMN "lastSeenAt";

-- DropTable
DROP TABLE "CameraImage";


-- The alert rules that watched for a camera going quiet or a picture being flagged belong to the
-- photo-upload flow that is gone. Their fire history goes with them (cascade).
DELETE FROM "OpsRule" WHERE "trigger" IN ('camera_offline', 'camera_flagged');
