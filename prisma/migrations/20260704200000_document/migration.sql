-- CreateTable: Document — dokumenty klienta (umowy, NDA, briefy) z opcją widoczności w portalu
CREATE TABLE "Document" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "storedPath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "size" INTEGER,
    "mime" TEXT,
    "visibleToClient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");
