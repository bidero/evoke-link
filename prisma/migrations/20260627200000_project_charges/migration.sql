-- CreateTable: pozycje rozliczeniowe projektu (kwoty w groszach)
CREATE TABLE "Charge" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "projectId" INTEGER NOT NULL,
  "label" TEXT,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "paidAt" DATETIME,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Charge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Charge_projectId_idx" ON "Charge"("projectId");
