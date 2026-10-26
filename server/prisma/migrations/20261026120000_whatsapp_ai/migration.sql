-- CreateTable
CREATE TABLE "WhatsAppAiSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL DEFAULT 'claude-haiku-5-5',
    "instructions" TEXT NOT NULL DEFAULT '',
    "maxRepliesPerHour" INTEGER NOT NULL DEFAULT 20,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transcriptionProvider" TEXT NOT NULL DEFAULT 'groq',
    "anthropicKey" TEXT,
    "transcriptionKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppKnowledge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAiReply" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inbound" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "handoffReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAiReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppKnowledge_active_idx" ON "WhatsAppKnowledge"("active");

-- CreateIndex
CREATE INDEX "WhatsAppAiReply_conversationId_createdAt_idx" ON "WhatsAppAiReply"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppAiReply_createdAt_idx" ON "WhatsAppAiReply"("createdAt");

