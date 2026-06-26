-- CreateTable: baza klientów
CREATE TABLE "Client" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "token" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_token_key" ON "Client"("token");

-- AlterTable: przypisanie projektu do klienta
ALTER TABLE "Project" ADD COLUMN "clientId" INTEGER;
