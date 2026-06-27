-- AlterTable: CRM-1 (kawałek 2) — pola firmy/kontaktu/statusu/tagów na kliencie
ALTER TABLE "Client" ADD COLUMN "company" TEXT;
ALTER TABLE "Client" ADD COLUMN "phone" TEXT;
ALTER TABLE "Client" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Client" ADD COLUMN "tags" TEXT;
