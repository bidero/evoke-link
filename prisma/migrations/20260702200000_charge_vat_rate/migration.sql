-- Stawka VAT pozycji rozliczeniowej (%). NULL = bez VAT (netto = brutto).
ALTER TABLE "Charge" ADD COLUMN "vatRate" INTEGER;
