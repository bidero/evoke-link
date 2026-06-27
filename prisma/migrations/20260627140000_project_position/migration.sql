-- AlterTable: ręczna kolejność projektów (drag & drop)
ALTER TABLE "Project" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
