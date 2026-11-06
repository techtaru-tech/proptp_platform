-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "anthropicApiKey" TEXT;
