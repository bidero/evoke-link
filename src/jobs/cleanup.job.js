// Sprzątanie wygasłych transferów. Uruchamiane z crona DirectAdmin (NIE node-cron),
// bo Passenger usypia proces przy braku ruchu.
//
// Konfiguracja crona w DirectAdmin (przykład — raz dziennie o 4:00):
//   0 4 * * *  cd /home/UZYTKOWNIK/domena && /sciezka/do/node src/jobs/cleanup.job.js
//
// Oznacza wygasłe transfery jako 'expired'. Plików z dysku ŚWIADOMIE nie kasuje: wygasły
// transfer można przywrócić przyciskiem „Przedłuż ważność" (reaktywacja), więc pliki muszą
// zostać. Usuwanie z dysku następuje dopiero przy skasowaniu transferu w panelu.
const prisma = require('../db/client');

async function run() {
  const now = new Date();
  const result = await prisma.transfer.updateMany({
    where: { status: 'active', expiresAt: { not: null, lt: now } },
    data: { status: 'expired' },
  });
  console.log(`[cleanup] oznaczono jako wygasłe: ${result.count}`);
}

run()
  .catch((e) => {
    console.error('[cleanup] błąd:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
