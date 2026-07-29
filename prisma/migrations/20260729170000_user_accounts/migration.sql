-- Konta użytkowników: aktywność + ostatnie logowanie (role już w kolumnie role).
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
