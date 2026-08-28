// Miniatury podglądów — generowane RAZ i cache'owane na dysku.
//
// PO CO: miniatura 48×48 px ładowała PEŁNY oryginał (przy zdjęciu 7 MB to ~1400× więcej,
// niż potrzeba), i to nie tylko w panelu, ale też u klienta na /t i /p — czyli często przez
// komórkę. Tutaj powstaje mały JPEG, który serwujemy zamiast oryginału.
//
// BEZ KOMPILACJI NATYWNEJ (zasada projektu): `jpeg-js` + `pngjs` to czysty JS, razem ~0,8 MB.
// Skalowanie piszemy sami — to kilkadziesiąt linii, a błąd jest najwyżej kosmetyczny
// (inaczej niż przy podpisach, gdzie świadomie bierzemy bibliotekę).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const storage = require('./storage.service');

const DIR = path.join(storage.TMP_DIR, 'thumbs');
const MAX_SIDE = 320;                    // starczy na 48 px przy ekranie 3× i na listę
const QUALITY = 72;
// Dekodowanie idzie do RGBA (4 bajty/piksel), więc obraz 40 MP to ~160 MB pamięci.
// Powyżej progu nie próbujemy — na shared hostingu to prosta droga do ubicia procesu.
const MAX_PIXELS = 30 * 1000 * 1000;
const MAX_BYTES = 60 * 1024 * 1024;

const isJpeg = (mime, name) => /jpe?g/i.test(mime || '') || /\.jpe?g$/i.test(name || '');
const isPng = (mime, name) => /png/i.test(mime || '') || /\.png$/i.test(name || '');

// Nazwa w cache'u wiąże się ze ŹRÓDŁEM i rozmiarem — plik pod danym storedPath nigdy się
// nie zmienia, więc trafienie w cache jest zawsze aktualne.
function cachePath(storedPath) {
  const key = crypto.createHash('sha1').update(`${storedPath}|${MAX_SIDE}|${QUALITY}`).digest('hex');
  return path.join(DIR, `${key}.jpg`);
}

// Orientacja z EXIF (APP1). Bez tego zdjęcia z telefonu wychodzą bokiem — parsujemy sam
// znacznik orientacji, bez dekodowania czegokolwiek więcej.
function exifOrientation(buf) {
  try {
    if (buf.readUInt16BE(0) !== 0xffd8) return 1;          // nie JPEG
    let off = 2;
    while (off + 4 < buf.length) {
      if (buf[off] !== 0xff) break;
      const marker = buf.readUInt16BE(off);
      const size = buf.readUInt16BE(off + 2);
      if (marker === 0xffe1 && buf.toString('ascii', off + 4, off + 10) === 'Exif\0\0') {
        const tiff = off + 10;
        const little = buf.toString('ascii', tiff, tiff + 2) === 'II';
        const u16 = (p) => (little ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
        const u32 = (p) => (little ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
        const ifd = tiff + u32(tiff + 4);
        const count = u16(ifd);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
        }
        return 1;
      }
      if (size <= 0) break;
      off += 2 + size;
    }
  } catch (_) { /* nieczytelny EXIF — traktujemy jak brak */ }
  return 1;
}

// Uśrednianie pikseli w prostokącie źródłowym (box filter). Prostsze niż Lanczos, a przy
// zmniejszaniu kilkukrotnym daje gładki wynik — w przeciwieństwie do zwykłego próbkowania,
// które przy dużym pomniejszeniu potrafi zgubić całe detale.
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let p = (sy * sw + x0) * 4;
        for (let sx = x0; sx < x1; sx++, p += 4) { r += src[p]; g += src[p + 1]; b += src[p + 2]; n++; }
      }
      const q = (y * dw + x) * 4;
      out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
    }
  }
  return out;
}

// Obrót/odbicie wg EXIF. Miniatura jest już mała, więc robimy to PO zmniejszeniu.
function applyOrientation(buf, w, h, o) {
  if (!o || o === 1) return { data: buf, width: w, height: h };
  const swap = o >= 5;
  const dw = swap ? h : w, dh = swap ? w : h;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x; ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y; ny = w - 1 - x; break;
        default: nx = x; ny = y;
      }
      const s = (y * w + x) * 4, d = (ny * dw + nx) * 4;
      out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; out[d + 3] = 255;
    }
  }
  return { data: out, width: dw, height: dh };
}

function decode(buf, mime, name) {
  if (isJpeg(mime, name)) {
    const d = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    return { data: d.data, width: d.width, height: d.height, orientation: exifOrientation(buf) };
  }
  if (isPng(mime, name)) {
    const p = PNG.sync.read(buf);
    return { data: p.data, width: p.width, height: p.height, orientation: 1 };
  }
  return null; // GIF/WebP/AVIF/BMP — nie dekodujemy, wołający poda oryginał
}

// Gotowa miniatura albo null — TANIE sprawdzenie, wolno je robić w trakcie żądania.
function cached(storedPath) {
  const out = cachePath(storedPath);
  return fs.existsSync(out) ? out : null;
}

// CIĘŻKA praca (dekodowanie JPEG to ~2,4 s przy 12 MP i jest synchroniczne, więc blokuje
// pętlę zdarzeń). Wołana z wątku roboczego, nigdy wprost z obsługi żądania.
// Nigdy nie rzuca: uszkodzony czy egzotyczny plik ma NIE psuć listy plików.
function generate(storedPath, mime, name) {
  try {
    const out = cachePath(storedPath);
    if (fs.existsSync(out)) return out;

    const abs = storage.absolutePath(storedPath);
    const stat = fs.statSync(abs);
    if (stat.size > MAX_BYTES) return null;

    const img = decode(fs.readFileSync(abs), mime, name);
    if (!img || !img.width || !img.height) return null;
    if (img.width * img.height > MAX_PIXELS) return null;

    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const dw = Math.max(1, Math.round(img.width * scale));
    const dh = Math.max(1, Math.round(img.height * scale));
    const small = scale < 1 ? downscale(img.data, img.width, img.height, dw, dh) : Buffer.from(img.data);
    const fixed = applyOrientation(small, dw, dh, img.orientation);
    const enc = jpeg.encode({ data: fixed.data, width: fixed.width, height: fixed.height }, QUALITY);

    // Zapis atomowy: przy dwóch równoległych żądaniach nikt nie zobaczy połówki pliku.
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, enc.data);
    fs.renameSync(tmp, out);
    return out;
  } catch (_) {
    return null; // każdy problem = spokojny powrót do oryginału
  }
}

// --- Generowanie w tle ---
//
// ZASADA: żadne żądanie nie czeka na miniaturę. Gdy jej jeszcze nie ma, oddajemy oryginał
// (czyli zachowanie sprzed zmiany — nie jest gorzej), a miniaturę robimy w tle. Kolejne
// wejście na tę samą listę jest już błyskawiczne.
//
// WĄTEK ROBOCZY, bo dekodowanie jest synchroniczne: robione wprost w procesie zablokowałoby
// pętlę zdarzeń na sekundy i wstrzymało WSZYSTKIE inne żądania (na Passengerze cały worker).
// `worker_threads` jest w rdzeniu Node — zero nowych zależności.
const { Worker } = require('worker_threads');
const WORKER = path.join(__dirname, '..', 'jobs', 'thumb.worker.js');
const queue = [];
const pending = new Set();   // ten sam plik nie trafia do kolejki dwa razy
let running = false;

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  const done = () => { pending.delete(job.storedPath); running = false; pump(); };
  try {
    const w = new Worker(WORKER, { workerData: job });
    w.once('message', done);
    w.once('error', done);        // uszkodzony plik — trudno, zostaje oryginał
    w.once('exit', () => { if (running) done(); });
  } catch (_) {
    done();                        // brak wątków roboczych — po prostu bez miniatur
  }
}

// Kolejka jednowątkowa: 20 zdjęć na liście nie zaleje serwera dwudziestoma dekodowaniami.
function schedule(storedPath, mime, name) {
  if (pending.has(storedPath) || pending.size > 200) return;
  pending.add(storedPath);
  queue.push({ storedPath, mime, name });
  pump();
}

// Wysłanie podglądu — JEDNO miejsce dla panelu, /t i /p (trzy trasy miały ten sam ogon).
// `thumb` = lista plików (mały JPEG), bez tego = Quick Look/pełny podgląd (oryginał).
function send(res, file, thumb) {
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (thumb) {
    const hit = cached(file.storedPath);
    if (hit) {
      res.setHeader('Content-Type', 'image/jpeg');
      // Miniatura jest niezmienna (klucz cache'u zawiera źródło) — pozwalamy trzymać ją długo.
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      return fs.createReadStream(hit).on('error', () => res.status(404).end()).pipe(res);
    }
    // Jeszcze jej nie ma: oddajemy oryginał TERAZ (bez czekania) i robimy miniaturę w tle.
    // Format, którego nie dekodujemy (GIF/WebP/AVIF), po prostu nigdy nie trafi do cache'u.
    schedule(file.storedPath, file.mimeType, file.originalName);
  }
  res.setHeader('Content-Type', file.mimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return storage.pipeDownload(res, file.storedPath);
}

module.exports = { cached, generate, schedule, send, cachePath, MAX_SIDE };
