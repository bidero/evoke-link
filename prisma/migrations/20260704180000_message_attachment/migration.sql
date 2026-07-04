-- AlterTable: załącznik (jeden plik) do wiadomości klient↔agencja
ALTER TABLE "Message" ADD COLUMN "attachmentPath" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "Message" ADD COLUMN "attachmentSize" INTEGER;
ALTER TABLE "Message" ADD COLUMN "attachmentMime" TEXT;
