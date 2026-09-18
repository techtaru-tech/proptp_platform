-- The number moved from the AiSensy reseller onto Meta Cloud API, which can list its own
-- approved templates. The mirrored campaign list and the reseller's credentials are therefore
-- dead weight, and the send log keeps its rows under provider-neutral names.

ALTER TABLE "WhatsAppTemplateSend" DROP CONSTRAINT "WhatsAppTemplateSend_templateId_fkey";
ALTER TABLE "WhatsAppTemplateSend" DROP COLUMN "templateId";
ALTER TABLE "WhatsAppTemplateSend" DROP COLUMN "providerResponse";

ALTER TABLE "WhatsAppTemplateSend" RENAME COLUMN "campaignName" TO "templateName";
ALTER TABLE "WhatsAppTemplateSend" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "WhatsAppTemplateSend" ADD COLUMN "body" TEXT;

DROP TABLE "WhatsAppTemplate";
DROP TABLE "WhatsAppTemplateSettings";
