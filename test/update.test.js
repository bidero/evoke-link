// Aktualizator z GitHuba: redakcja tokenów, parsowanie commitów, plik stanu + lock,
// smoke endpointu statusu. NIE wykonuje realnego git fetch/npm install (sieć/czas).
// UWAGA: dotyka storage/tmp/update-status.json — snapshot + restore w finally.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const upd = require('../src/services/update.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

function snapshotStatus() {
  try { return fs.readFileSync(upd.STATUS_FILE, 'utf8'); } catch (_) { return null; }
}
function restoreStatus(snap) {
  if (snap === null) { try { fs.unlinkSync(upd.STATUS_FILE); } catch (_) {} }
  else fs.writeFileSync(upd.STATUS_FILE, snap);
}

test('redact: token w URL-u nie wycieka do logów/błędów', () => {
  assert.equal(
    upd.redact('remote: https://bidero:ghp_SEKRET123@github.com/bidero/evoke-link.git'),
    'remote: https://***@github.com/bidero/evoke-link.git'
  );
  assert.equal(upd.redact('fatal: https://x-access-token:abc@github.com/a/b'), 'fatal: https://***@github.com/a/b');
  assert.equal(upd.redact('zwykły tekst bez adresu'), 'zwykły tekst bez adresu');
  assert.equal(upd.redact('https://github.com/bidero/evoke-link.git'), 'https://github.com/bidero/evoke-link.git', 'URL bez poświadczeń bez zmian');
  assert.equal(upd.redact(null), '');
});

test('parseCommits: format hash\\x1ftemat\\x1fdata, redakcja tematów', () => {
  const raw = 'abc1234\x1ffeat: nowa funkcja\x1f2026-07-10\ndef5678\x1ffix: https://user:tok@github.com/x\x1f2026-07-09';
  const list = upd.parseCommits(raw);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { hash: 'abc1234', subject: 'feat: nowa funkcja', date: '2026-07-10' });
  assert.equal(list[1].subject, 'fix: https://***@github.com/x');
  assert.deepEqual(upd.parseCommits(''), []);
});

test('plik stanu: merge zapisu, lock aktualizacji i stale-lock', () => {
  const snap = snapshotStatus();
  try {
    upd.writeStatus({ state: 'idle', notifiedHash: 'aaa' });
    upd.writeStatus({ state: 'running', startedAt: new Date().toISOString() });
    const st = upd.readStatus();
    assert.equal(st.state, 'running');
    assert.equal(st.notifiedHash, 'aaa', 'merge zachowuje wcześniejsze pola');
    assert.equal(upd.isRunning(), true);
    assert.throws(() => upd.startUpdate(), /już trwa/, 'lock blokuje drugą aktualizację');

    // martwy lock (job padł > 30 min temu) nie blokuje
    upd.writeStatus({ startedAt: new Date(Date.now() - 31 * 60000).toISOString() });
    assert.equal(upd.isRunning(), false);

    upd.writeStatus({ state: 'idle' });
    assert.equal(upd.isRunning(), false);
  } finally {
    restoreStatus(snap);
  }
});

test('wersja bieżąca czytana z package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(upd.currentVersion(), pkg.version);
});

test('GET /admin/update/status: wymaga logowania, zwraca JSON ze stanem', async (t) => {
  const anon = await fetch(`${base}/admin/update/status`, { redirect: 'manual' });
  assert.equal(anon.status, 302, 'bez logowania przekierowanie na login');

  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');
  const r = await fetch(`${base}/admin/update/status`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(['idle', 'running', 'done', 'failed'].includes(d.state));
  assert.equal(d.version, upd.currentVersion());
  assert.equal(typeof d.log, 'string');

  // sekcja w ustawieniach obecna (zakładka Zaawansowane)
  const html = await (await fetch(`${base}/admin/settings?tab=advanced`, { headers: { Cookie: cookie } })).text();
  assert.match(html, /Sprawdź aktualizacje/);
  assert.match(html, /Zainstalowana wersja/);
  assert.match(html, /tab: 'advanced'/, 'deep-link ?tab=advanced ustawia zakładkę');
});
