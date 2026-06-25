-- Dodaje kolumnę na konfigurację tła stron klienta (JSON jako string).
-- Kolory elementów panelu admina mieszczą się w istniejącej kolumnie "colors".
ALTER TABLE "Settings" ADD COLUMN "background" TEXT;
