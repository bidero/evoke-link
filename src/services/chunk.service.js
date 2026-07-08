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
const MAX_FILES = 5000;           // bezpiecznik na liczbę plików w sesji (folder potrafi mieć setki)
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

// Nazwa pliku od klienta może być ścieżką względną z folderu ('katalog/plik.pdf' —
// ZIP odtwarza wtedy strukturę). Wycinamy wszystko, co pozwoliłoby wyjść poza nią:
// backslashe, wiodące ukośniki/dyski, segmenty '.' i '..', znaki sterujące.
function sanitizeRelName(name) {
  const parts = String(name || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
  return parts.join('/').slice(0, 512);
}

// Metadane pliku trzymamy w OSOBNYM pliku <fi>.meta (nie we wspólnym manifeście):
// wspólny manifest.json był czytany i przepisywany w całości przy KAŻDYM kawałku
// (kwadratowy koszt przy setkach plików) i miał wyścig read-modify-write, gdy kawałki
// różnych plików trafiały do różnych procesów Passengera. Każdy kawałek tego samego
// pliku niesie te same metadane, więc zapis jest idempotentny.
function metaPath(uploadId, fi) {
  return path.join(sessionDir(uploadId), fi + '.meta');
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

  if (!fs.existsSync(metaPath(uploadId, fi))) {
    fs.writeFileSync(metaPath(uploadId, fi), JSON.stringify({
      name: sanitizeRelName(meta.name) || 'plik-' + fi,
      type: meta.type || '',
      total,
    }));
  }
}

// Łączy kawałki 0..total-1 jednego pliku w <fi>.bin — STRUMIENIOWO (nie blokuje
// pętli zdarzeń, niska pamięć). Zwraca true gdy plik kompletny i sklejony.
function concatFile(uploadId, fi, total) {
  return new Promise((resolve, reject) => {
    for (let ci = 0; ci < total; ci++) {
      if (!fs.existsSync(chunkPath(uploadId, fi, ci))) return resolve(false); // niekompletny
    }
    const finalPath = path.join(sessionDir(uploadId), fi + '.bin');
    const ws = fs.createWriteStream(finalPath);
    ws.on('error', reject);
    ws.on('finish', () => resolve(true));
    let ci = 0;
    (function nextChunk() {
      if (ci >= total) { ws.end(); return; }
      const rs = fs.createReadStream(chunkPath(uploadId, fi, ci));
      rs.on('error', reject);
      rs.on('end', () => { ci += 1; nextChunk(); });
      rs.pipe(ws, { end: false });
    })();
  });
}

// Składa sesję: dla każdego pliku skleja kawałki strumieniowo. Asynchroniczne.
// Zwraca tablicę plików w kształcie multera. Pliki niekompletne są pomijane.
async function assembleFiles(uploadId) {
  const dir = sessionDir(uploadId);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return []; }
  const indices = entries
    .filter((n) => n.endsWith('.meta'))
    .map((n) => parseInt(n, 10))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  const out = [];
  for (const fi of indices) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath(uploadId, fi), 'utf8')); } catch (_) { continue; }
    const total = Math.max(1, parseInt(meta.total, 10) || 1);
    const okFile = await concatFile(uploadId, fi, total);
    if (!okFile) continue;
    const finalPath = path.join(dir, fi + '.bin');
    out.push({
      originalname: meta.name || ('plik-' + fi),
      path: finalPath,
      size: fs.statSync(finalPath).size,
      mimetype: meta.type || null,
    });
  }
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
