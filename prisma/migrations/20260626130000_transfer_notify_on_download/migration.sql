-- AlterTable: powiadomienie e-mail do agencji przy pierwszym pobraniu transferu
ALTER TABLE "Transfer" ADD COLUMN "notifyOnDownload" BOOLEAN NOT NULL DEFAULT false;
