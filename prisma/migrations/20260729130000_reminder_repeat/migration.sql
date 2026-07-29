-- Przypomnienia cykliczne: seria materializowana (wspólny seriesId).
ALTER TABLE "Reminder" ADD COLUMN "repeat" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "repeatUntil" DATETIME;
ALTER TABLE "Reminder" ADD COLUMN "seriesId" TEXT;
CREATE INDEX "Reminder_seriesId_idx" ON "Reminder"("seriesId");
