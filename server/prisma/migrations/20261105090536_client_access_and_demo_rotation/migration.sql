-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DemoBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "records" JSONB NOT NULL,
    "summary" JSONB,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "DemoBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoBatch_createdAt_idx" ON "DemoBatch"("createdAt");
