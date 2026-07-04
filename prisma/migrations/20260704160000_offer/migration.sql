-- CreateTable: Offer — oferta/wycena do akceptacji przez klienta (/o/:token)
CREATE TABLE "Offer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "validUntil" DATETIME,
    "decidedAt" DATETIME,
    "decisionName" TEXT,
    "decisionComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Offer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Offer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: OfferItem — pozycja oferty (netto/szt. + ilość + VAT)
CREATE TABLE "OfferItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offerId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "vatRate" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_token_key" ON "Offer"("token");
CREATE INDEX "Offer_clientId_idx" ON "Offer"("clientId");
CREATE INDEX "OfferItem_offerId_idx" ON "OfferItem"("offerId");
