-- AlterTable: dane nabywcy na dokument rozliczenia (NIP, adres)
ALTER TABLE "Client" ADD COLUMN "nip" TEXT;
ALTER TABLE "Client" ADD COLUMN "address" TEXT;
