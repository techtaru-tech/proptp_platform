-- AlterTable
ALTER TABLE "TelephonySettings" DROP COLUMN "fallbackNumber",
DROP COLUMN "outboundMode",
DROP COLUMN "stickyRouting",
DROP COLUMN "testRouteNumber",
ADD COLUMN     "accountId" TEXT,
ALTER COLUMN "provider" SET DEFAULT 'deepcall',
ALTER COLUMN "baseUrl" SET DEFAULT 'https://v4-api.deepcall.com/api';


-- The Airphone credentials and routing rules mean nothing to DeepCall. Reset the row to the new
-- provider, switched off, until the DeepCall account id and token are saved.
UPDATE "TelephonySettings"
SET "provider" = 'deepcall', "baseUrl" = 'https://v4-api.deepcall.com/api', "apiToken" = NULL, "enabled" = false;
