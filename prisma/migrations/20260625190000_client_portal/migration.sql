-- AlterTable: panel klienta na poziomie projektu
ALTER TABLE "Project" ADD COLUMN "clientToken" TEXT;
ALTER TABLE "Project" ADD COLUMN "clientPasswordHash" TEXT;

-- AlterTable: widoczność transferu w panelu klienta
ALTER TABLE "Transfer" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Project_clientToken_key" ON "Project"("clientToken");
