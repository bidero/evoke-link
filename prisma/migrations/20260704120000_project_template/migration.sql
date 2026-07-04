-- CreateTable: ProjectTemplate — szablony projektów (startowa lista braków + przypomnienia)
CREATE TABLE "ProjectTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "items" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
