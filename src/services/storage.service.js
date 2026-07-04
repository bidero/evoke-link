// Warstwa dostępu do plików na dysku. CAŁA aplikacja zapisuje/czyta pliki
// przez ten moduł — dzięki temu w przyszłości podmienisz dysk lokalny na S3
// zmieniając tylko ten jeden plik.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

// Katalog na finalne pliki transferów oraz katalog tymczasowy na świeże uploady.
const STORAGE_DIR = config.storageDir;
const TMP_DIR = path.join(path.dirname(STORAGE_DIR), 'tmp');

// Upewnij się, że katalogi istnieją (przy starcie aplikacji i przy uploadzie).
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
ensureDir(STORAGE_DIR);
ensureDir(TMP_DIR);

// Bezpieczna, losowa nazwa pliku na dysku (oryginalna nazwa żyje w bazie).
function makeStoredName(originalName) {
  const ext = path.extname(originalName || '').slice(0, 20); // ucinamy dziwne długie "rozszerzenia"
  return crypto.randomBytes(16).toString('hex') + ext;
}

// Katalog konkretnego transferu: storage/transfers/<token>/
function transferDir(token) {
  return path.join(STORAGE_DIR, token);
}

// Przenosi plik z katalogu tymczasowego do katalogu transferu.
// Zwraca ścieżkę WZGLĘDNĄ (zapisywaną w bazie jako File.storedPath).
function moveToTransfer(tmpPath, token, storedName) {
  const destDir = ensureDir(transferDir(token));
  const destPath = path.join(destDir, storedName);
  fs.renameSync(tmpPath, destPath);
  return path.join(token, storedName); // względna do STORAGE_DIR
}

// Absolutna ścieżka pliku na podstawie storedPath z bazy.
function absolutePath(storedPath) {
  return path.join(STORAGE_DIR, storedPath);
}

// Strumień do odczytu pliku (do pobierania bez ładowania całości do pamięci).
function readStream(storedPath) {
  return fs.createReadStream(absolutePath(storedPath));
}

// Usuwa cały katalog transferu (przy kasowaniu transferu).
function removeTransfer(token) {
  fs.rmSync(transferDir(token), { recursive: true, force: true });
}

// Sprząta plik tymczasowy (np. gdy coś poszło nie tak po uploadzie).
function removeTmp(tmpPath) {
  try {
    fs.rmSync(tmpPath, { force: true });
  } catch (_) {
    /* ignorujemy */
  }
}

// Załączniki wiadomości: przenosi z tmp do storage/transfers/_messages/ (podkatalog
// z podkreśleniem, żeby nie kolidował z tokenami transferów). Zwraca ścieżkę WZGLĘDNĄ.
function saveMessageFile(tmpPath, storedName) {
  const destDir = ensureDir(path.join(STORAGE_DIR, '_messages'));
  const destPath = path.join(destDir, storedName);
  fs.renameSync(tmpPath, destPath);
  return path.join('_messages', storedName);
}

// Usuwa pojedynczy plik po ścieżce względnej (np. przy kasowaniu wiadomości z załącznikiem).
function removeStored(storedPath) {
  try { fs.rmSync(absolutePath(storedPath), { force: true }); } catch (_) { /* ignorujemy */ }
}

// Suma rozmiarów wszystkich plików w storage (dla widżetu "wykorzystane miejsce").
function totalUsedBytes() {
  let total = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch (_) {
          /* pomijamy */
        }
      }
    }
  };
  walk(STORAGE_DIR);
  return total;
}

module.exports = {
  STORAGE_DIR,
  TMP_DIR,
  ensureDir,
  makeStoredName,
  transferDir,
  moveToTransfer,
  absolutePath,
  readStream,
  removeTransfer,
  removeTmp,
  saveMessageFile,
  removeStored,
  totalUsedBytes,
};
