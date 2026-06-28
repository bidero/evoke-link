// Backup danych: spójna kopia bazy (VACUUM INTO) + pliki transferów, spakowane ZIP-em.
// Uruchamiane z crona DirectAdmin (NIE node-cron — Passenger usypia proces).
//
// Cron (przykład — codziennie o 3:30):
//   30 3 * * *  cd /home/UZYTKOWNIK/domena && /sciezka/do/node src/jobs/backup.job.js
//
// Konfiguracja przez .env (opcjonalnie):
//   BACKUP_DIR   — katalog na backupy (domyślnie ./backups, poza repo)
//   BACKUP_KEEP  — ile ostatnich zachować (domyślnie 14)
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const prisma = require('../db/client');
const storage = require('../services/storage.service');

const ROOT = process.cwd();
const STORAGE_ROOT = path.dirname(storage.STORAGE_DIR); // .../storage (zawiera transfers/, tmp/, evoke.db)
const DB_FILE = path.join(STORAGE_ROOT, 'evoke.db');
const BACKUP_DIR = path.resolve(ROOT, process.env.BACKUP_DIR || './backups');
const KEEP = parseInt(process.env.BACKUP_KEEP, 10) || 14;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Usuwa najstarsze backupy ponad limit KEEP. Zwraca łączną liczbę backupów (przed rotacją).
function rotate() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^evoke-backup-.*\.zip$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.slice(KEEP).forEach((x) => { try { fs.rmSync(path.join(BACKUP_DIR, x.f)); } catch (_) {} });
  return files.length;
}

async function run() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const s = stamp();
  const tmpDb = path.join(BACKUP_DIR, `.snapshot-${s}.db.tmp`);
  const zipPath = path.join(BACKUP_DIR, `evoke-backup-${s}.zip`);

  // 1) Spójny snapshot bazy — VACUUM INTO działa nawet przy uruchomionym serwerze.
  let dbToZip = DB_FILE;
  try {
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb);
    await prisma.$executeRawUnsafe(`VACUUM INTO '${tmpDb.replace(/\\/g, '/')}'`);
    dbToZip = tmpDb;
  } catch (e) {
    console.warn('[backup] VACUUM INTO nieudane — pakuję plik bazy wprost:', e.message);
  }

  // 2) ZIP: baza + katalog plików transferów (tmp pomijamy).
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    if (fs.existsSync(dbToZip)) archive.file(dbToZip, { name: 'evoke.db' });
    if (fs.existsSync(storage.STORAGE_DIR)) archive.directory(storage.STORAGE_DIR, 'transfers');
    archive.finalize();
  });

  if (dbToZip === tmpDb) { try { fs.rmSync(tmpDb); } catch (_) {} }

  const sizeMB = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  const total = rotate();
  console.log(`[backup] zapisano ${path.basename(zipPath)} (${sizeMB} MB) → ${BACKUP_DIR}; backupów: ${Math.min(total, KEEP)} (limit ${KEEP})`);
}

run()
  .catch((e) => { console.error('[backup] błąd:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
