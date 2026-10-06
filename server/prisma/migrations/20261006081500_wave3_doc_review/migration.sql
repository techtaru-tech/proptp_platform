-- AlterTable
ALTER TABLE "AgreementStep" DROP COLUMN "reviewNote",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedByName",
DROP COLUMN "status",
DROP COLUMN "supersededAt",
DROP COLUMN "version";

-- AlterTable
ALTER TABLE "LegalDocument" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByName" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;


-- Documents the system generated need no review.
UPDATE "LegalDocument" SET "status" = 'verified' WHERE "generated" = true;
