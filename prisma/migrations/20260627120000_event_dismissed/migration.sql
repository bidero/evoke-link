-- AlterTable: miękkie usuwanie powiadomień (historia projektu pozostaje nienaruszona)
ALTER TABLE "Event" ADD COLUMN "dismissed" BOOLEAN NOT NULL DEFAULT false;
