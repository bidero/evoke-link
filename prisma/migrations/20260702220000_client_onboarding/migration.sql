-- AlterTable: link onboardingowy — jednorazowy formularz uzupełnienia danych CRM przez klienta
ALTER TABLE "Client" ADD COLUMN "onboardingToken" TEXT;
ALTER TABLE "Client" ADD COLUMN "onboardingExpiresAt" DATETIME;
ALTER TABLE "Client" ADD COLUMN "onboardingCompletedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Client_onboardingToken_key" ON "Client"("onboardingToken");
