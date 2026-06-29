// Backup danych (baza + pliki) — cron DirectAdmin (NIE node-cron). Logika w backup.service.
// Cron (przykład — codziennie o 3:30):
//   30 3 * * *  cd /home/UZYTKOWNIK/domena && /sciezka/do/node src/jobs/backup.job.js
// Auto-backup można wyłączyć w panelu (Ustawienia → Zaawansowane) — wtedy cron pomija.
// Konfiguracja .env: BACKUP_DIR (domyślnie ./backups), BACKUP_KEEP (domyślnie 14).
const path = require('path');
const prisma = require('../db/client');
const backup = require('../services/backup.service');

const KEEP = parseInt(process.env.BACKUP_KEEP, 10) || 14;

async function run() {
  if (backup.isAutoDisabled()) { console.log('[backup] auto wyłączony w panelu — pomijam'); return; }
  const r = await backup.saveBackup('all');
  const total = backup.rotate(KEEP);
  console.log(`[backup] zapisano ${path.basename(r.path)} (${(r.size / 1048576).toFixed(1)} MB) → ${backup.BACKUP_DIR}; backupów: ${Math.min(total, KEEP)} (limit ${KEEP})`);
}

run()
  .catch((e) => { console.error('[backup] błąd:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
