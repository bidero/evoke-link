// Upload katalogu przez chunked upload: nazwy plików niosą ścieżkę względną
// ('katalog/plik.pdf'), kawałki lecą równolegle/w dowolnej kolejności, a serwer
// sanityzuje próby wyjścia poza katalog ('../..'). Integralność sprawdzana md5.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const transferService = require('../src/services/transfer.service');
const storage = require('../src/services/storage.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const CHUNK = 5 * 1024 * 1024;

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

async function sendChunk(token, uploadId, fi, name, buf, ci, total) {
  const fd = new FormData();
  fd.append('uploadId', uploadId);
  fd.append('fileIndex', String(fi));
  fd.append('fileName', name);
  fd.append('fileType', 'application/pdf');
  fd.append('chunkIndex', String(ci));
  fd.append('totalChunks', String(total));
  fd.append('chunk', new Blob([buf]), 'chunk');
  const r = await fetch(`${base}/upload/${token}/chunk`, { method: 'POST', body: fd });
  assert.equal(r.status, 200, `kawałek ${fi}/${ci} przyjęty`);
}

test('upload folderu: ścieżki względne, kawałki poza kolejnością, sanityzacja ../', async () => {
  const t = await transferService.createUploadRequest({ title: 'TEST_folder_' + Date.now() });
  const uploadId = crypto.randomBytes(16).toString('hex');
  try {
    // Plik wielokawałkowy (6 MB → 2 kawałki) w podkatalogu — wysyłamy 2. kawałek PRZED 1.
    const big = crypto.randomBytes(6 * 1024 * 1024);
    await sendChunk(t.token, uploadId, 0, 'katalog/podfolder/duzy.pdf', big.subarray(CHUNK), 1, 2);
    await sendChunk(t.token, uploadId, 0, 'katalog/podfolder/duzy.pdf', big.subarray(0, CHUNK), 0, 2);
    // Mały plik z próbą wyjścia poza katalog — ma zostać spłaszczony do 'zly.pdf'.
    const small = Buffer.from('%PDF-1.4 test');
    await sendChunk(t.token, uploadId, 1, '../../zly.pdf', small, 0, 1);

    const fin = await fetch(`${base}/upload/${t.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ uploadId, name: 'Tester' }),
    });
    assert.equal(fin.status, 200, 'finalizacja OK');

    const files = await prisma.file.findMany({ where: { transferId: t.id }, orderBy: { id: 'asc' } });
    assert.equal(files.length, 2, 'oba pliki zapisane');
    assert.equal(files[0].originalName, 'katalog/podfolder/duzy.pdf', 'ścieżka względna zachowana');
    assert.equal(files[1].originalName, 'zly.pdf', "segmenty '..' wycięte");
    assert.equal(Number(files[0].size), big.length, 'rozmiar dużego pliku');
    assert.equal(md5(fs.readFileSync(storage.absolutePath(files[0].storedPath))), md5(big), 'md5 dużego pliku (kolejność kawałków)');
    assert.equal(md5(fs.readFileSync(storage.absolutePath(files[1].storedPath))), md5(small), 'md5 małego pliku');
  } finally {
    const full = await transferService.getById(t.id);
    if (full) await transferService.remove(full);
  }
});

test('duża liczba plików (>500) przechodzi — regresja: 400 „Nieprawidłowy indeks pliku"', async () => {
  const t = await transferService.createUploadRequest({ title: 'TEST_many_' + Date.now() });
  const uploadId = crypto.randomBytes(16).toString('hex');
  const COUNT = 520; // ponad stary limit MAX_FILES=500
  try {
    const jobs = Array.from({ length: COUNT }, (_, fi) => fi);
    const pool = 25;
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const fi = jobs[next++];
        await sendChunk(t.token, uploadId, fi, `partia/plik-${fi}.txt`, Buffer.from('zawartość ' + fi), 0, 1);
      }
    }
    await Promise.all(Array.from({ length: pool }, worker));

    const fin = await fetch(`${base}/upload/${t.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ uploadId }),
    });
    assert.equal(fin.status, 200, 'finalizacja OK');

    const files = await prisma.file.findMany({ where: { transferId: t.id } });
    assert.equal(files.length, COUNT, 'wszystkie pliki zapisane');
    const f519 = files.find((f) => f.originalName === 'partia/plik-519.txt');
    assert.ok(f519, 'plik z indeksem powyżej starego limitu istnieje');
    assert.equal(fs.readFileSync(storage.absolutePath(f519.storedPath), 'utf8'), 'zawartość 519');
  } finally {
    const full = await transferService.getById(t.id);
    if (full) await transferService.remove(full);
  }
});
