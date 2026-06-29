-- AlterTable: imię i nazwisko klienta (opcjonalne) — personalizacja maili ({imie}/{nazwisko}).
-- Addytywnie: pole "name" pozostaje pełną/wyświetlaną nazwą; powitania wolą firstName z fallbackiem do name.
ALTER TABLE "Client" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Client" ADD COLUMN "lastName" TEXT;
