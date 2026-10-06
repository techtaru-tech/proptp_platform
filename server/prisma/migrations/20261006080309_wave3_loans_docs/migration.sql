-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LegalDocKind" ADD VALUE 'patta';
ALTER TYPE "LegalDocKind" ADD VALUE 'no_dues';

-- AlterTable
ALTER TABLE "AgreementStep" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByName" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Registry" ADD COLUMN     "possessionNote" TEXT,
ADD COLUMN     "possessionOn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesPolicy" ADD COLUMN     "requiredDocKinds" TEXT[] DEFAULT ARRAY['kyc', 'booking_form', 'agreement']::TEXT[];

-- CreateTable
CREATE TABLE "BankLoan" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "appliedOn" TIMESTAMP(3) NOT NULL,
    "sanctionedOn" TIMESTAMP(3),
    "sanctionedAmount" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanDisbursement" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankLoan_fileId_key" ON "BankLoan"("fileId");

-- CreateIndex
CREATE INDEX "LoanDisbursement_loanId_idx" ON "LoanDisbursement"("loanId");

-- AddForeignKey
ALTER TABLE "BankLoan" ADD CONSTRAINT "BankLoan_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "LegalFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanDisbursement" ADD CONSTRAINT "LoanDisbursement_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BankLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
