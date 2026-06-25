// Jedna współdzielona instancja klienta Prisma na całą aplikację.
// (Tworzenie wielu instancji wyczerpuje połączenia — dlatego singleton.)
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
