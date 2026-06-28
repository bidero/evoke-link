-- Termin płatności pozycji (do wiekowania należności i przypomnień) + znacznik
-- ostatniego wysłanego przypomnienia (anty-spam w cronie przypomnień).
ALTER TABLE "Charge" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Charge" ADD COLUMN "remindedAt" DATETIME;
