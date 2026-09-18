-- CreateTable
CREATE TABLE "WhatsAppTemplateSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'aisensy',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://backend.api-wa.co/campaign/smartping/api/v2',
    "apiKey" TEXT,
    "senderName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "paramLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bodyPreview" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplateSend" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignName" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "params" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "providerResponse" JSONB,
    "leadId" TEXT,
    "sentBy" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplateSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_campaignName_key" ON "WhatsAppTemplate"("campaignName");

-- CreateIndex
CREATE INDEX "WhatsAppTemplateSend_sentAt_idx" ON "WhatsAppTemplateSend"("sentAt");

-- AddForeignKey
ALTER TABLE "WhatsAppTemplateSend" ADD CONSTRAINT "WhatsAppTemplateSend_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
