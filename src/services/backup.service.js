// Wspólna logika backupu (cron + ręczne wywołanie z panelu).
// Auto-backup można wyłączyć z panelu — sygnalizuje to plik-flaga BACKUP_DIR/.disabled
// (bez zmian w bazie/migracji). scope: 'all' (baza + pliki) | 'db' (sama baza).
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const prisma = require('../db/client');
const storage = require('./storage.service');

const STORAGE_ROOT = path.dirname(storage.STORAGE_DIR);
const DB_FILE = path.join(STORAGE_ROOT, 'evoke.db');
const BACKUP_DIR = path.resolve(process.cwd(), process.env.BACKUP_DIR || './backups');
const DISABLED_FLAG = path.join(BACKUP_DIR, '.disabled');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function ensureDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function isAutoDisabled() { try { return fs.existsSync(DISABLED_FLAG); } catch (_) { return false; } }
function setAuto(enabled) {
  ensureDir();
  if (enabled) { try { fs.rmSync(DISABLED_FLAG); } catch (_) {} }
  else fs.writeFileSync(DISABLED_FLAG, 'auto-backup wyłączony ' + new Date().toISOString());
}

// Spójny snapshot bazy (VACUUM INTO). Zwraca ścieżkę tmp albo null (wtedy bierzemy żywy plik).
async function snapshotDb() {
  ensureDir();
  const tmp = path.join(BACKUP_DIR, `.snapshot-${stamp()}-${Math.random().toString(16).slice(2, 8)}.db.tmp`);
  try {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    await prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/\\/g, '/')}'`);
    return tmp;
  } catch (e) {
    console.warn('[backup] VACUUM INTO nieudane — biorę plik bazy wprost:', e.message);
    return null;
  }
}

// Buduje ZIP do strumienia wyjściowego (plik lub odpowiedź HTTP).
async function archiveTo(outStream, scope) {
  const snap = await snapshotDb();
  const dbToZip = snap || DB_FILE;
  await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    outStream.on('close', resolve);
    outStream.on('finish', resolve);
    archive.on('error', reject);
    archive.pipe(outStream);
    if (fs.existsSync(dbToZip)) archive.file(dbToZip, { name: 'evoke.db' });
    if (scope !== 'db' && fs.existsSync(storage.STORAGE_DIR)) archive.directory(storage.STORAGE_DIR, 'transfers');
    archive.finalize();
  });
  if (snap) { try { fs.rmSync(snap); } catch (_) {} }
}

// Strumieniuje backup do odpowiedzi HTTP (pobranie z panelu).
function streamBackup(res, scope) {
  const fname = `evoke-backup-${stamp()}${scope === 'db' ? '-db' : ''}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  return archiveTo(res, scope);
}

// Zapisuje backup do BACKUP_DIR (cron). Zwraca { path, size }.
async function saveBackup(scope) {
  ensureDir();
  const zipPath = path.join(BACKUP_DIR, `evoke-backup-${stamp()}.zip`);
  await archiveTo(fs.createWriteStream(zipPath), scope);
  return { path: zipPath, size: fs.statSync(zipPath).size };
}

// Rotacja — zostawia najnowsze KEEP. Zwraca liczbę backupów przed rotacją.
function rotate(keep) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^evoke-backup-.*\.zip$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.slice(keep).forEach((x) => { try { fs.rmSync(path.join(BACKUP_DIR, x.f)); } catch (_) {} });
  return files.length;
}

module.exports = { BACKUP_DIR, isAutoDisabled, setAuto, snapshotDb, streamBackup, saveBackup, rotate, stamp };
