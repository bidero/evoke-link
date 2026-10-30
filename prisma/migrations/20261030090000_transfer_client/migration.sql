-- Transfer przypisany wprost do klienta (dotąd tylko przez projekt).
-- SQLite: ALTER TABLE ADD COLUMN z kluczem obcym jest dozwolone, gdy domyślna wartość to NULL.
ALTER TABLE "Transfer" ADD COLUMN "clientId" INTEGER REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uzupełnienie istniejących transferów z projektów, które mają klienta (spójność filtrów/listy).
UPDATE "Transfer" SET "clientId" = (SELECT "clientId" FROM "Project" WHERE "Project"."id" = "Transfer"."projectId")
WHERE "clientId" IS NULL AND "projectId" IS NOT NULL;

CREATE INDEX "Transfer_clientId_idx" ON "Transfer"("clientId");
