-- CreateTable
CREATE TABLE "LeadCustomField" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCustomValue" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "LeadCustomValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCustomField_key_key" ON "LeadCustomField"("key");

-- CreateIndex
CREATE INDEX "LeadCustomValue_fieldId_value_idx" ON "LeadCustomValue"("fieldId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCustomValue_leadId_fieldId_key" ON "LeadCustomValue"("leadId", "fieldId");

-- AddForeignKey
ALTER TABLE "LeadCustomValue" ADD CONSTRAINT "LeadCustomValue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomValue" ADD CONSTRAINT "LeadCustomValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "LeadCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
