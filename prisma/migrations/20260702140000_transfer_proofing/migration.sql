-- AlterTable: proofing — akceptacja/poprawki dostarczonych plików przez klienta
ALTER TABLE "Transfer" ADD COLUMN "proofing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transfer" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "approvalComment" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "approvalBy" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "approvalAt" DATETIME;
