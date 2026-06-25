// Składanie uploadów dzielonych na kawałki (chunked upload).
// Klient wysyła plik kawałkami (~5 MB) na endpoint /chunk; tutaj dopisujemy je
// do pliku części w storage/tmp/chunks/<uploadId>/<fileIndex>.part. Po zebraniu
// wszystkich plików endpoint tworzący (transfer/upload) woła assembleFiles(),
// który zwraca listę w kształcie multera: { originalname, path, size, mimetype }.
const fs = require('fs');
const path = require('path');
const storage = require('./storage.service');

const CHUNK_ROOT = path.join(storage.TMP_DIR, 'chunks');
storage.ensureDir(CHUNK_ROOT);

const ID_RE = /^[a-f0-9]{16,64}$/i;
const MAX_FILES = 500;          // bezpiecznik na liczbę plików w sesji
const STALE_MS = 24 * 60 * 60 * 1000; // sesje starsze niż 24h uznajemy za porzucone

function sessionDir(uploadId) {
  if (!ID_RE.test(uploadId || '')) throw new Error('Nieprawidłowy identyfikator uploadu');
  return path.join(CHUNK_ROOT, uploadId);
}

function fileIndexInt(fileIndex) {
  const i = parseInt(fileIndex, 10);
  if (!Number.isInteger(i) || i < 0 || i >= MAX_FILES) throw new Error('Nieprawidłowy indeks pliku');
  return i;
}

function partPath(uploadId, fileIndex) {
  return path.join(sessionDir(uploadId), fileIndexInt(fileIndex) + '.part');
}

function manifestPath(uploadId) {
  return path.join(sessionDir(uploadId), 'manifest.json');
}

function readManifest(uploadId) {
  try { return JSON.parse(fs.readFileSync(manifestPath(uploadId), 'utf8')); }
  catch (_) { return { files: {} }; }
}

function writeManifest(uploadId, m) {
  fs.writeFileSync(manifestPath(uploadId), JSON.stringify(m));
}

// Dopisuje pojedynczy kawałek. meta: { name, type, chunkIndex }.
// chunkIndex === 0 zaczyna plik od nowa (nadpisanie), kolejne dopisują.
function appendChunk(uploadId, fileIndex, buffer, meta) {
  const dir = sessionDir(uploadId);
  storage.ensureDir(dir);
  const i = fileIndexInt(fileIndex);
  const pp = partPath(uploadId, i);
  const ci = parseInt(meta.chunkIndex, 10) || 0;

  if (ci === 0) fs.writeFileSync(pp, buffer);
  else fs.appendFileSync(pp, buffer);

  const m = readManifest(uploadId);
  if (!m.files[i]) m.files[i] = {};
  if (meta.name) m.files[i].name = meta.name;
  if (!m.files[i].name) m.files[i].name = 'plik-' + i;
  if (meta.type) m.files[i].type = meta.type;
  writeManifest(uploadId, m);
}

// Składa sesję w listę plików w kształcie multera (do podania jako req.files).
function assembleFiles(uploadId) {
  const m = readManifest(uploadId);
  const out = [];
  Object.keys(m.files)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .forEach((i) => {
      const pp = partPath(uploadId, i);
      if (!fs.existsSync(pp)) return;
      out.push({
        originalname: m.files[i].name || ('plik-' + i),
        path: pp,
        size: fs.statSync(pp).size,
        mimetype: m.files[i].type || null,
      });
    });
  return out;
}

// Usuwa katalog sesji (po zakończeniu albo przy błędzie).
function cleanup(uploadId) {
  try { fs.rmSync(sessionDir(uploadId), { recursive: true, force: true }); } catch (_) {}
}

// Sprząta porzucone sesje (starsze niż STALE_MS) — wołane przy starcie i z crona.
function sweepOld() {
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(CHUNK_ROOT, { withFileTypes: true }); } catch (_) { return 0; }
  const now = Date.now();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(CHUNK_ROOT, e.name);
    try {
      if (now - fs.statSync(p).mtimeMs > STALE_MS) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
    } catch (_) {}
  }
  return removed;
}

// Posprzątaj porzucone sesje przy starcie aplikacji.
try { sweepOld(); } catch (_) {}

module.exports = { appendChunk, assembleFiles, cleanup, sweepOld, CHUNK_ROOT, ID_RE };
