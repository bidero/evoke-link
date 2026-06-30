-- AlterTable: znacznik wysłanego ostrzeżenia o wygasaniu transferu (anty-powtórka)
ALTER TABLE "Transfer" ADD COLUMN "expiryWarnedAt" DATETIME;
