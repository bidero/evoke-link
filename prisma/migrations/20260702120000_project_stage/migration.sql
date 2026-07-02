-- AlterTable: etap pipeline'u projektu (kanban): lead | active | delivered | paid
ALTER TABLE "Project" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'active';
