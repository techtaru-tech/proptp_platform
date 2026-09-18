-- Data already migrated to AutomationStep rows (see project memory / one-off script run
-- before this migration) — these columns are now redundant.
ALTER TABLE "Automation" DROP COLUMN "conditions",
DROP COLUMN "assignMode",
DROP COLUMN "assignUserIds",
DROP COLUMN "assignTeamId",
DROP COLUMN "overwrite";
