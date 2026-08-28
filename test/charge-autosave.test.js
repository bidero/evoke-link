// Auto-zapis pozycji rozliczeniowej.
//
// GŁÓWNE RYZYKO tej zmiany: kontroler (`clients.updateCharge`) buduje z body PEŁNY obiekt
// pozycji. Gdyby przeglądarka wysyłała tylko zmienione pole, reszta (nazwa, VAT, daty)
// zostałaby wyzerowana. Skrypt wysyła cały formularz — ten test pilnuje kontraktu z obu stron:
// komplet pól zapisuje poprawnie, a wysyłka niepełna faktycznie kasuje dane (czyli skrypt
// NIE MOŻE wysyłać fragmentu — i dlatego widok renderuje wszystkie pola w panelu edycji).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');

let base, server, cookie;
before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
  if (!process.env.ADMIN_PASSWORD) return;
  const r = await fetch(`${base}/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }), redirect: 'manual',
  });
  cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
});
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function fixture() {
  const st = Date.now();
  const client = await prisma.client.create({ data: { name: 'Autosave ' + st, token: 'as_' + st } });
  const project = await prisma.project.create({ data: { name: 'Projekt ' + st, clientId: client.id, clientToken: 'asp_' + st } });
  const charge = await prisma.charge.create({ data: {
    projectId: project.id, label: 'Kaseton', amount: 50000, vatRate: 23,
    date: new Date('2026-06-09'), dueDate: new Date('2026-07-13'),
  } });
  return { client, project, charge };
}
async function cleanup({ client, project }) {
  await prisma.charge.deleteMany({ where: { OR: [{ projectId: project.id }, { clientId: client.id }] } });
  await prisma.event.deleteMany({ where: { OR: [{ clientId: client.id }, { projectId: project.id }] } });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.client.delete({ where: { id: client.id } });
}

const post = (url, fields) => fetch(url, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
  body: new URLSearchParams(fields),
});

test('auto-zapis pełnym formularzem: zmienia jedno pole i NIE rusza pozostałych', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture();
  try {
    // Tak wysyła skrypt: komplet pól z panelu edycji, ze zmienioną kwotą.
    const res = await post(`${base}/admin/clients/${f.client.id}/charges/${f.charge.id}`, {
      label: 'Kaseton', projectId: String(f.project.id), amount: '750,00', vatRate: '23',
      date: '2026-06-09', dueDate: '2026-07-13', paidAt: '',
    });
    assert.equal(res.status, 302, 'zapis odpowiada przekierowaniem (to łapie fetch jako sukces)');

    const after = await prisma.charge.findUnique({ where: { id: f.charge.id } });
    assert.equal(after.amount, 75000, 'kwota zmieniona (przecinek dziesiętny obsłużony)');
    assert.equal(after.label, 'Kaseton', 'nazwa nietknięta');
    assert.equal(after.vatRate, 23, 'VAT nietknięty');
    assert.equal(after.projectId, f.project.id, 'projekt nietknięty');
    assert.equal(after.dueDate.toISOString().slice(0, 10), '2026-07-13', 'termin nietknięty');
    assert.equal(after.paidAt, null, 'pozycja dalej nierozliczona');
  } finally {
    await cleanup(f);
  }
});

test('wysyłka NIEPEŁNA kasuje dane — dlatego panel edycji renderuje wszystkie pola', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture();
  try {
    await post(`${base}/admin/clients/${f.client.id}/charges/${f.charge.id}`, { amount: '500,00' });
    const after = await prisma.charge.findUnique({ where: { id: f.charge.id } });
    assert.equal(after.vatRate, null, 'brak vatRate w body = wyczyszczony');
    assert.ok(!after.label, 'brak label w body = utracona nazwa');
    // To jest właśnie powód, dla którego autosave.js wysyła `new FormData(form)` w całości.
  } finally {
    await cleanup(f);
  }
});

test('widok: wiersz jest zwarty (bez pól), panel edycji ma etykiety i auto-zapis', async (t) => {
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const f = await fixture();
  try {
    const html = await (await fetch(`${base}/admin/clients/${f.client.id}?tab=rozliczenia`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /data-autosave/, 'formularz edycji oznaczony do auto-zapisu');
    assert.match(html, /data-saved/, 'miejsce na potwierdzenie „Zapisano"');
    assert.match(html, /<span class="label">Kwota netto<\/span>/, 'etykieta NAD polem');
    assert.match(html, /<span class="label">Data rozliczenia<\/span>/, 'data rozliczenia w panelu, nie w wierszu');
    // Panel edycji jest domyślnie schowany — wiersz ma być zwarty.
    assert.match(html, /x-show="open === \d+"/);
    assert.match(html, /data-nojs-save/, 'zapasowy przycisk zapisu dla przeglądarki bez JS');
  } finally {
    await cleanup(f);
  }
});
