-- AlterTable: własne tło strony logowania (null = dziedziczy tło stron klienta)
ALTER TABLE "Settings" ADD COLUMN "loginBackground" TEXT;
