// Składanie uploadów dzielonych na kawałki (chunked upload) — odporne na kolejność.
// Klient może wysyłać kawałki RÓWNOLEGLE, więc każdy kawałek zapisujemy do osobnego
// pliku storage/tmp/chunks/<uploadId>/<fileIndex>_<chunkIndex>.part, a przy składaniu
// łączymy je po indeksach (0..total-1). Wynik to lista w kształcie multera:
// { originalname, path, size, mimetype }.
const fs = require('fs');
const path = require('path');
const storage = require('./storage.service');

const CHUNK_ROOT = path.join(storage.TMP_DIR, 'chunks');
storage.ensureDir(CHUNK_ROOT);

const ID_RE = /^[a-f0-9]{16,64}$/i;
const MAX_FILES = 500;            // bezpiecznik na liczbę plików w sesji
const MAX_CHUNKS = 200000;        // bezpiecznik na liczbę kawałków w pliku
const STALE_MS = 24 * 60 * 60 * 1000; // sesje starsze niż 24h = porzucone

function sessionDir(uploadId) {
  if (!ID_RE.test(uploadId || '')) throw new Error('Nieprawidłowy identyfikator uploadu');
  return path.join(CHUNK_ROOT, uploadId);
}

function intInRange(v, max, label) {
  const i = parseInt(v, 10);
  if (!Number.isInteger(i) || i < 0 || i >= max) throw new Error('Nieprawidłowy ' + label);
  return i;
}

function chunkPath(uploadId, fileIndex, chunkIndex) {
  return path.join(sessionDir(uploadId), fileIndex + '_' + chunkIndex + '.part');
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

// Zapisuje pojedynczy kawałek do własnego pliku (kolejność dowolna).
// meta: { name, type, chunkIndex, totalChunks }.
function writeChunk(uploadId, fileIndex, buffer, meta) {
  const dir = sessionDir(uploadId);
  storage.ensureDir(dir);
  const fi = intInRange(fileIndex, MAX_FILES, 'indeks pliku');
  const ci = intInRange(meta.chunkIndex, MAX_CHUNKS, 'indeks kawałka');
  const total = Math.max(1, parseInt(meta.totalChunks, 10) || 1);

  fs.writeFileSync(chunkPath(uploadId, fi, ci), buffer);

  const m = readManifest(uploadId);
  if (!m.files[fi]) m.files[fi] = {};
  if (meta.name) m.files[fi].name = meta.name;
  if (!m.files[fi].name) m.files[fi].name = 'plik-' + fi;
  if (meta.type) m.files[fi].type = meta.type;
  m.files[fi].total = Math.max(total, m.files[fi].total || 0);
  writeManifest(uploadId, m);
}

// Składa sesję: dla każdego pliku łączy kawałki 0..total-1 w jeden plik <fi>.bin.
// Zwraca tablicę plików w kształcie multera. Pliki niekompletne są pomijane.
function assembleFiles(uploadId) {
  const m = readManifest(uploadId);
  const dir = sessionDir(uploadId);
  const out = [];
  Object.keys(m.files)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .forEach((fi) => {
      const meta = m.files[fi];
      const total = Math.max(1, parseInt(meta.total, 10) || 1);
      const finalPath = path.join(dir, fi + '.bin');
      fs.writeFileSync(finalPath, Buffer.alloc(0));
      let complete = true;
      for (let ci = 0; ci < total; ci++) {
        const cp = chunkPath(uploadId, fi, ci);
        if (!fs.existsSync(cp)) { complete = false; break; }
        fs.appendFileSync(finalPath, fs.readFileSync(cp)); // jeden kawałek naraz — niska pamięć
      }
      if (!complete) { try { fs.rmSync(finalPath, { force: true }); } catch (_) {} return; }
      out.push({
        originalname: meta.name || ('plik-' + fi),
        path: finalPath,
        size: fs.statSync(finalPath).size,
        mimetype: meta.type || null,
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

try { sweepOld(); } catch (_) {}

module.exports = { writeChunk, assembleFiles, cleanup, sweepOld, CHUNK_ROOT, ID_RE };
