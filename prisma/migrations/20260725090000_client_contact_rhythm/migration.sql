-- Rytm kontaktu per klient: przypominaj o kontakcie co N dni (null = brak rytmu).
ALTER TABLE "Client" ADD COLUMN "contactEveryDays" INTEGER;
