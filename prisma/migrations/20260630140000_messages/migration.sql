-- CreateTable: wiadomości od klienta (Faza A — jednokierunkowo klient → agencja)
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "body" TEXT NOT NULL,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "clientId" INTEGER,
    "projectId" INTEGER,
    "transferId" INTEGER,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_clientId_idx" ON "Message"("clientId");
CREATE INDEX "Message_projectId_idx" ON "Message"("projectId");
CREATE INDEX "Message_transferId_idx" ON "Message"("transferId");
