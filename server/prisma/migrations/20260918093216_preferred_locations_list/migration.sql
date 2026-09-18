-- A buyer can be interested in more than one area, so the single location becomes a list.
-- Whatever one location a lead already had becomes a list of one; a blank becomes an empty list.
ALTER TABLE "Lead" ADD COLUMN "preferredLocations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Lead"
   SET "preferredLocations" = ARRAY["preferredLocation"]
 WHERE "preferredLocation" IS NOT NULL AND "preferredLocation" <> '';

ALTER TABLE "Lead" DROP COLUMN "preferredLocation";
