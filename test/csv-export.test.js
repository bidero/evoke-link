// Eksport list do CSV (/admin/clients.csv, /admin/transfers.csv) + sortowanie transferów
// i filtr po tagu klientów. Sprawdzamy nagłówki pobierania, format (BOM/;/CRLF) i to,
// że eksport respektuje TE SAME filtry co widok listy.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const transferService = require('../src/services/transfer.service');
const clientService = require('../src/services/client.service');
const csv = require('../src/utils/csv');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('utils/csv: separator, escapowanie, BOM, CRLF, kwoty i slug', () => {
  const out = csv.build([['a', 'b'], ['zwykłe', 'ma;średnik'], ['ma "cudzysłów"', 'dwie\nlinie']]);
  assert.ok(out.startsWith('﻿'), 'BOM dla Excela');
  const lines = out.split('\r\n');
  assert.equal(lines[0], '﻿a;b');
  assert.equal(lines[1], 'zwykłe;"ma;średnik"', 'średnik wymusza cudzysłowy');
  assert.match(out, /"ma ""cudzysłów"""/, 'cudzysłów podwojony');
  assert.match(out, /"dwie\nlinie"/, 'nowa linia w cudzysłowach');
  assert.equal(out.slice(-2), '\r\n', 'plik kończy się CRLF');
  assert.equal(csv.money(123456), '1234,56');
  assert.equal(csv.money(null), '0,00');
  assert.equal(csv.slug('Żółta Ćma sp. z o.o.'), 'zolta-cma-sp-z-o-o');
  assert.equal(csv.slug('***', 'klient'), 'klient', 'fallback gdy nic nie zostanie');
});

test('/admin/clients.csv: nagłówki pobierania, dane klienta i filtr po tagu', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const anon = await fetch(`${base}/admin/clients.csv`, { redirect: 'manual' });
  assert.equal(anon.status, 302, 'eksport wymaga logowania');

  const stamp = Date.now();
  const a = await prisma.client.create({ data: { name: 'CSV Vip ' + stamp, company: 'Firma; z średnikiem', email: 'vip@example.com', tags: 'vip, druk', token: 'csv_a_' + stamp } });
  const b = await prisma.client.create({ data: { name: 'CSV Zwykły ' + stamp, tags: 'vip-plus', token: 'csv_b_' + stamp } });
  try {
    const r = await fetch(`${base}/admin/clients.csv?q=${stamp}`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="klienci\.csv"/);
    // UWAGA: fetch().text() USUWA BOM przy dekodowaniu — sprawdzamy surowe bajty.
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM w bajtach odpowiedzi');
    const body = await r.text();
    assert.match(body.split('\r\n')[0], /^Nazwa;Firma;/);
    assert.match(body, new RegExp('CSV Vip ' + stamp));
    assert.match(body, /"Firma; z średnikiem"/, 'średnik w danych escapowany');
    assert.match(body, new RegExp('/c/csv_a_' + stamp), 'link portalu w eksporcie');

    // Filtr po tagu = DOKŁADNE dopasowanie: „vip" nie łapie „vip-plus".
    const tagged = await fetch(`${base}/admin/clients.csv?q=${stamp}&tag=vip`, { headers: { Cookie: cookie } });
    const tb = await tagged.text();
    assert.match(tb, new RegExp('CSV Vip ' + stamp), 'klient z tagiem vip w eksporcie');
    assert.ok(!tb.includes('CSV Zwykły ' + stamp), '„vip-plus" NIE jest tagiem „vip"');

    // Ten sam filtr działa w serwisie (widok listy korzysta z niego wprost).
    const listed = await clientService.list({ q: String(stamp), tag: 'vip' });
    assert.deepEqual(listed.map((c) => c.id), [a.id]);
  } finally {
    for (const c of [a, b]) await prisma.client.delete({ where: { id: c.id } }).catch(() => {});
  }
});

test('/admin/transfers.csv + sortowanie listy transferów', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const stamp = Date.now();
  const soon = new Date(Date.now() + 2 * 3600e3);
  const later = new Date(Date.now() + 30 * 86400e3);
  const big = await prisma.transfer.create({ data: { token: 'csvt_big_' + stamp, direction: 'outgoing', title: 'CSV Duży ' + stamp, downloadCount: 1, expiresAt: later, files: { create: [{ originalName: 'a.bin', storedName: 'a', storedPath: 'x/a', size: BigInt(5000) }] } } });
  const small = await prisma.transfer.create({ data: { token: 'csvt_small_' + stamp, direction: 'outgoing', title: 'CSV Mały ' + stamp, downloadCount: 9, expiresAt: soon, files: { create: [{ originalName: 'b.bin', storedName: 'b', storedPath: 'x/b', size: BigInt(10) }] } } });
  const noExp = await prisma.transfer.create({ data: { token: 'csvt_noexp_' + stamp, direction: 'incoming', title: 'CSV Bez terminu ' + stamp } });
  try {
    const only = (list) => list.filter((x) => String(x.title || '').includes(String(stamp))).map((x) => x.id);

    assert.deepEqual(only(await transferService.list({ q: String(stamp), sort: 'size_desc' })), [big.id, small.id, noExp.id], 'największe pierwsze');
    assert.deepEqual(only(await transferService.list({ q: String(stamp), sort: 'downloads_desc' })).slice(0, 2), [small.id, big.id], 'najwięcej pobrań');
    const byExpiry = only(await transferService.list({ q: String(stamp), sort: 'expires_asc' }));
    assert.deepEqual(byExpiry, [small.id, big.id, noExp.id], 'najbliższy termin pierwszy, bez terminu na końcu');
    // Nieznana wartość sortowania → domyślne (najnowsze), bez wysypki.
    assert.equal(only(await transferService.list({ q: String(stamp), sort: 'zzz' }))[0], noExp.id);
    // Filtr kierunku
    assert.deepEqual(only(await transferService.list({ q: String(stamp), direction: 'incoming' })), [noExp.id]);

    const r = await fetch(`${base}/admin/transfers.csv?q=${stamp}&sort=size_desc`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /filename="transfery\.csv"/);
    const rows = (await r.text()).split('\r\n');
    assert.match(rows[0], /^Kierunek;Tytuł;Token;/);
    const idx = (t2) => rows.findIndex((x) => x.includes(t2));
    assert.ok(idx('CSV Duży') < idx('CSV Mały'), 'kolejność sortowania zachowana w CSV');
    assert.match(rows[idx('CSV Duży')], /;5000;/, 'rozmiar w bajtach');
    assert.match(rows[idx('CSV Bez terminu')], /^Od klienta;/, 'kierunek opisany słownie');

    // Widok listy zachowuje filtry w linku eksportu.
    const html = await (await fetch(`${base}/admin/transfers?q=${stamp}&sort=size_desc`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /\/admin\/transfers\.csv\?q=/, 'przycisk CSV z bieżącymi filtrami');
    assert.match(html, /sort=size_desc/);
  } finally {
    for (const x of [big, small, noExp]) await prisma.transfer.delete({ where: { id: x.id } }).catch(() => {});
  }
});
