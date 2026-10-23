-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "botRepliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppBot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "triggerType" TEXT NOT NULL DEFAULT 'any',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownHours" INTEGER NOT NULL DEFAULT 12,
    "startKey" TEXT NOT NULL DEFAULT 'm1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppBotNode" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "headerImageUrl" TEXT,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "handoff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WhatsAppBotNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppBot_status_idx" ON "WhatsAppBot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppBotNode_botId_key_key" ON "WhatsAppBotNode"("botId", "key");

-- AddForeignKey
ALTER TABLE "WhatsAppBotNode" ADD CONSTRAINT "WhatsAppBotNode_botId_fkey" FOREIGN KEY ("botId") REFERENCES "WhatsAppBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

