-- CreateEnum
CREATE TYPE "LegalDocKind" AS ENUM ('kyc', 'booking_form', 'allotment_letter', 'agreement', 'receipt', 'demand_note', 'correspondence', 'other');

-- CreateEnum
CREATE TYPE "AgreementStage" AS ENUM ('draft', 'sent', 'under_review', 'signed', 'executed', 'stamped');

-- CreateEnum
CREATE TYPE "RegistryStatus" AS ENUM ('pending', 'documents_in_preparation', 'stamp_duty_paid', 'appointment_booked', 'registered');

-- CreateEnum
CREATE TYPE "MutationStatus" AS ENUM ('pending', 'applied', 'completed');

-- CreateTable
CREATE TABLE "LegalFile" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "agreedValue" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" "LegalDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "milestoneId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementStep" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "stage" "AgreementStage" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "responsible" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "demandedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestonePayment" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestonePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registry" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" "RegistryStatus" NOT NULL DEFAULT 'pending',
    "appointmentOn" TIMESTAMP(3),
    "registryDate" TIMESTAMP(3),
    "subRegistrar" TEXT,
    "deedNumber" TEXT,
    "deedUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectApproval" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "khasra" TEXT NOT NULL,
    "area" TEXT,
    "conversionOrder" TEXT,
    "mutation" "MutationStatus" NOT NULL DEFAULT 'pending',
    "titleDocUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "fileId" TEXT,
    "title" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "nextHearing" TIMESTAMP(3),
    "documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalTemplate" (
    "kind" "LegalDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalTemplate_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalFile_bookingId_key" ON "LegalFile"("bookingId");

-- CreateIndex
CREATE INDEX "LegalFile_projectId_idx" ON "LegalFile"("projectId");

-- CreateIndex
CREATE INDEX "LegalDocument_fileId_kind_idx" ON "LegalDocument"("fileId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementStep_fileId_stage_key" ON "AgreementStep"("fileId", "stage");

-- CreateIndex
CREATE INDEX "PaymentMilestone_fileId_idx" ON "PaymentMilestone"("fileId");

-- CreateIndex
CREATE INDEX "MilestonePayment_milestoneId_idx" ON "MilestonePayment"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Registry_fileId_key" ON "Registry"("fileId");

-- CreateIndex
CREATE INDEX "ProjectApproval_projectId_idx" ON "ProjectApproval"("projectId");

-- CreateIndex
CREATE INDEX "LandRecord_projectId_idx" ON "LandRecord"("projectId");

-- CreateIndex
CREATE INDEX "LegalCase_closed_nextHearing_idx" ON "LegalCase"("closed", "nextHearing");

-- AddForeignKey
ALTER TABLE "LegalFile" ADD CONSTRAINT "LegalFile_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalFile" ADD CONSTRAINT "LegalFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementStep" ADD CONSTRAINT "AgreementStep_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestonePayment" ADD CONSTRAINT "MilestonePayment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registry" ADD CONSTRAINT "Registry_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectApproval" ADD CONSTRAINT "ProjectApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandRecord" ADD CONSTRAINT "LandRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
