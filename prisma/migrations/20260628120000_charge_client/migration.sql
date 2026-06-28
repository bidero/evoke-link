-- Pozycja rozliczeniowa może należeć do projektu LUB wprost do klienta.
-- projectId staje się opcjonalne; dochodzi opcjonalne clientId.
-- SQLite nie zmieni NOT NULL→NULL ani nie doda FK przez ALTER — przebudowa tabeli.
-- FK clientId: ON DELETE RESTRICT — usunięcie klienta z pozycjami „bez projektu"
-- blokujemy w aplikacji; RESTRICT jest siatką bezpieczeństwa na poziomie bazy.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Charge" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "projectId" INTEGER,
  "clientId" INTEGER,
  "label" TEXT,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "date" DATETIME,
  "paidAt" DATETIME,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Charge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Charge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Charge" ("id", "projectId", "clientId", "label", "amount", "date", "paidAt", "note", "createdAt")
SELECT "id", "projectId", NULL, "label", "amount", "date", "paidAt", "note", "createdAt" FROM "Charge";

DROP TABLE "Charge";
ALTER TABLE "new_Charge" RENAME TO "Charge";

CREATE INDEX "Charge_projectId_idx" ON "Charge"("projectId");
CREATE INDEX "Charge_clientId_idx" ON "Charge"("clientId");

PRAGMA foreign_keys=ON;
