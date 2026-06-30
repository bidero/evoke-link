-- AlterTable: obraz podglądu linku (OpenGraph) — gdy puste, używane jest logo.
ALTER TABLE "Settings" ADD COLUMN "ogImagePath" TEXT;
