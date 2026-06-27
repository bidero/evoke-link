-- AlterTable: CRM-1 (kawałek 3) — powiązanie zdarzenia z klientem (oś czasu + notatki).
-- Sama kolumna (jak Project.clientId); odpięcie przy usuwaniu klienta robi warstwa aplikacji.
ALTER TABLE "Event" ADD COLUMN "clientId" INTEGER;
