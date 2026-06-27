-- AlterTable: data pozycji rozliczeniowej (filtrowanie zakresem dat + wydruk)
ALTER TABLE "Charge" ADD COLUMN "date" DATETIME;
