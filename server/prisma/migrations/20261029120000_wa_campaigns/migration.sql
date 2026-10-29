-- CreateTable
CREATE TABLE "WaCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'flow',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "termsUrl" TEXT,
    "dailySendCap" INTEGER NOT NULL DEFAULT 250,
    "slotCap" INTEGER NOT NULL DEFAULT 0,
    "introTemplate" TEXT,
    "introLanguage" TEXT NOT NULL DEFAULT 'en',
    "introHeaderVideoUrl" TEXT,
    "introParams" TEXT[] DEFAULT ARRAY['{first_name}', '{terms_url}']::TEXT[],
    "nudgeTemplate" TEXT,
    "nudgeLanguage" TEXT NOT NULL DEFAULT 'en',
    "nudgeParams" TEXT[] DEFAULT ARRAY['{first_name}']::TEXT[],
    "confirmTemplate" TEXT,
    "reminderTemplate" TEXT,
    "demoVideoEn" TEXT,
    "demoVideoHi" TEXT,
    "minSamples" INTEGER NOT NULL DEFAULT 50,
    "minLabAgeYears" INTEGER NOT NULL DEFAULT 3,
    "copy" JSONB NOT NULL DEFAULT '{}',
    "calendlyUrl" TEXT,
    "calendlyToken" TEXT,
    "calendlySigningKey" TEXT,
    "calendlyWebhookId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaContact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "optInStatus" TEXT NOT NULL DEFAULT 'opted_in',
    "optInSource" TEXT NOT NULL DEFAULT '',
    "optInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "language" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "introSentAt" TIMESTAMP(3),
    "importBatch" TEXT,
    "sampleBand" TEXT,
    "professionalType" TEXT,
    "labAgeYears" INTEGER,
    "b2c" BOOLEAN,
    "labName" TEXT,
    "city" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'none',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMeeting" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "inviteeUri" TEXT NOT NULL,
    "eventUri" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "joinUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaOptOut" (
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaOptOut_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE INDEX "WaCampaign_status_idx" ON "WaCampaign"("status");

-- CreateIndex
CREATE INDEX "WaContact_campaignId_state_idx" ON "WaContact"("campaignId", "state");

-- CreateIndex
CREATE INDEX "WaContact_state_nextActionAt_idx" ON "WaContact"("state", "nextActionAt");

-- CreateIndex
CREATE INDEX "WaContact_phone_idx" ON "WaContact"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "WaContact_campaignId_phone_key" ON "WaContact"("campaignId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "WaMeeting_inviteeUri_key" ON "WaMeeting"("inviteeUri");

-- CreateIndex
CREATE INDEX "WaMeeting_status_startsAt_idx" ON "WaMeeting"("status", "startsAt");

-- CreateIndex
CREATE INDEX "WaEvent_campaignId_type_idx" ON "WaEvent"("campaignId", "type");

-- CreateIndex
CREATE INDEX "WaEvent_contactId_idx" ON "WaEvent"("contactId");

-- AddForeignKey
ALTER TABLE "WaContact" ADD CONSTRAINT "WaContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WaCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaContact" ADD CONSTRAINT "WaContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMeeting" ADD CONSTRAINT "WaMeeting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WaContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

