-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'team_leader';

-- CreateIndex
CREATE INDEX "User_reportingLeaderId_idx" ON "User"("reportingLeaderId");
