// Edycja zawartości istniejącego transferu: dodawanie i usuwanie plików z panelu.
// Sprawdza też, że zmiana plików czyści decyzję proofingu i że nie da się usunąć
// pliku należącego do INNEGO transferu.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');
const transferService = require('../src/services/transfer.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

// Transfer wychodzący z jednym plikiem (przez serwis, jak przy tworzeniu z panelu).
async function makeTransfer(label, { proofing = false } = {}) {
  const tmp = path.join('storage', 'tmp', `t-${label}-${Date.now()}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from('pierwszy-' + label));
  return transferService.createOutgoingTransfer({
    title: 'Test ' + label, proofing,
    uploadedFiles: [{ originalname: 'pierwszy.txt', path: tmp, size: 9, mimetype: 'text/plain' }],
  });
}

test('transfer: dodanie i usunięcie plików z panelu (plik znika też z dysku)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const transfer = await makeTransfer('add');
  try {
    // ── dodanie dwóch plików do ISTNIEJĄCEGO transferu
    const bytes = Buffer.from('nowa-tresc-' + Date.now());
    const fd = new FormData();
    fd.append('files', new Blob([bytes], { type: 'application/pdf' }), 'dodany.pdf');
    fd.append('files', new Blob([Buffer.from('drugi')], { type: 'text/plain' }), 'drugi.txt');
    const up = await fetch(`${base}/admin/transfers/${transfer.id}/files`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' });
    assert.equal(up.status, 302);
    assert.match(up.headers.get('location'), new RegExp(`/admin/transfers/${transfer.id}$`));
    await wait(200);

    let files = await prisma.file.findMany({ where: { transferId: transfer.id }, orderBy: { id: 'asc' } });
    assert.equal(files.length, 3, 'pierwotny plik + dwa dodane');
    const added = files.find((f) => f.originalName === 'dodany.pdf');
    assert.ok(added, 'dodany plik w bazie');
    assert.equal(Number(added.size), bytes.length);
    assert.ok(fs.existsSync(storage.absolutePath(added.storedPath)), 'dodany plik leży na dysku');

    // ── usunięcie jednego pliku
    const del = await fetch(`${base}/admin/transfers/${transfer.id}/file/${added.id}/delete`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(del.status, 302);
    await wait(200);

    files = await prisma.file.findMany({ where: { transferId: transfer.id } });
    assert.equal(files.length, 2, 'wiersz usunięty z bazy');
    assert.ok(!files.some((f) => f.id === added.id));
    assert.ok(!fs.existsSync(storage.absolutePath(added.storedPath)), 'plik usunięty z dysku');

    // ── bramka logowania: bez sesji trafiamy na login, plik zostaje
    const anon = await fetch(`${base}/admin/transfers/${transfer.id}/file/${files[0].id}/delete`, { method: 'POST', redirect: 'manual' });
    assert.match(anon.headers.get('location') || '', /\/admin\/login/, 'bez sesji przekierowanie na logowanie');
    assert.ok(await prisma.file.findUnique({ where: { id: files[0].id } }), 'plik nietknięty bez logowania');
  } finally {
    const t2 = await transferService.getById(transfer.id);
    if (t2) await transferService.remove(t2);
  }
});

test('transfer bez plików: ZIP nie wydaje pustego archiwum i nie zlicza pobrania', async () => {
  // Stan osiągalny dopiero odkąd admin może usuwać pliki z panelu — wcześniej transfer
  // wychodzący zawsze miał co najmniej jeden plik.
  const transfer = await makeTransfer('empty');
  try {
    for (const f of await prisma.file.findMany({ where: { transferId: transfer.id } })) {
      await transferService.removeFile(transfer.id, f.id);
    }
    const before = await prisma.transfer.findUnique({ where: { id: transfer.id } });

    const page = await fetch(`${base}/t/${transfer.token}`);
    assert.equal(page.status, 200, 'strona publiczna dalej działa');

    const zip = await fetch(`${base}/t/${transfer.token}/zip`);
    assert.equal(zip.status, 404, 'brak pustego archiwum');

    const after = await prisma.transfer.findUnique({ where: { id: transfer.id } });
    assert.equal(after.downloadCount, before.downloadCount, 'pobranie nie zliczone (limit nietknięty)');
  } finally {
    const t2 = await transferService.getById(transfer.id);
    if (t2) await transferService.remove(t2);
  }
});

test('transfer: nie da się usunąć pliku należącego do innego transferu', async () => {
  const a = await makeTransfer('a');
  const b = await makeTransfer('b');
  try {
    const fileOfB = (await prisma.file.findMany({ where: { transferId: b.id } }))[0];
    // podpięcie id pliku z B pod transfer A musi być bezskuteczne
    const res = await transferService.removeFile(a.id, fileOfB.id);
    assert.equal(res, null, 'obcy plik nie jest usuwany');
    assert.ok(await prisma.file.findUnique({ where: { id: fileOfB.id } }), 'plik B dalej w bazie');
    assert.ok(fs.existsSync(storage.absolutePath(fileOfB.storedPath)), 'plik B dalej na dysku');
  } finally {
    for (const id of [a.id, b.id]) { const t = await transferService.getById(id); if (t) await transferService.remove(t); }
  }
});

test('transfer z proofingiem: zmiana plików czyści decyzję klienta', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const transfer = await makeTransfer('proof', { proofing: true });
  try {
    // klient zatwierdza dostarczony zestaw
    await transferService.setDecision(transfer.id, { decision: 'approved', name: 'Klient' });
    let t1 = await prisma.transfer.findUnique({ where: { id: transfer.id } });
    assert.equal(t1.approvalStatus, 'approved');

    // dodanie pliku = inny zestaw → decyzja nieaktualna
    const fd = new FormData();
    fd.append('files', new Blob([Buffer.from('poprawka')], { type: 'text/plain' }), 'poprawka.txt');
    await fetch(`${base}/admin/transfers/${transfer.id}/files`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' });
    await wait(250);

    t1 = await prisma.transfer.findUnique({ where: { id: transfer.id } });
    assert.equal(t1.approvalStatus, null, 'status akceptacji wyczyszczony');
    assert.equal(t1.approvalAt, null);
    assert.equal(t1.approvalBy, null);

    // ślad w historii, żeby było wiadomo dlaczego status zniknął
    const ev = await prisma.event.findMany({ where: { transferId: transfer.id, type: 'updated' } });
    assert.ok(ev.some((e) => /akceptacji/i.test(e.message)), 'zdarzenie o wyczyszczeniu akceptacji');
  } finally {
    const t2 = await transferService.getById(transfer.id);
    if (t2) await transferService.remove(t2);
  }
});
