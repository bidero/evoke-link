// Testy podstawowe — aplikacja wstaje i serwuje kluczowe trasy publiczne.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('GET / przekierowuje do panelu', async () => {
  const r = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin');
});

test('GET /admin/login zwraca 200 i formularz logowania', async () => {
  const r = await fetch(`${base}/admin/login`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
});

test('panel wymaga logowania (GET /admin → 302 na login)', async () => {
  const r = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location') || '', /\/admin\/login/);
});

test('nieistniejący token pobrania → 404', async () => {
  const r = await fetch(`${base}/t/nie-istnieje-xyz123`);
  assert.equal(r.status, 404);
});
