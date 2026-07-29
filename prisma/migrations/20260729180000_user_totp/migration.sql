-- 2FA (TOTP): sekret, moment włączenia, kody zapasowe (hashe).
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "recoveryCodes" TEXT;
