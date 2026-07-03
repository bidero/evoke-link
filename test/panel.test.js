// Konfigurowalny panel: scalanie menu/widżetów (panelUi) + zapis układu pulpitu.
// UWAGA: test dotyka wiersza Settings — snapshot + restore w finally (wspólna baza dev).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const panelUi = require('../src/utils/panelUi');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('panelUi: scalanie i sanityzacja menu/widżetów', () => {
  // pusta konfiguracja = pełna lista domyślna, nic ukryte
  const def = panelUi.mergeMenu([]);
  assert.equal(def.length, panelUi.MENU.length);
  assert.ok(def.every((m) => !m.hidden));

  // zapisana kolejność + ukrycie + własna etykieta; nieznany klucz odrzucony; brakujące doklejone
  const merged = panelUi.mergeMenu([
    { key: 'clients', hidden: false, label: 'Kontrahenci' },
    { key: 'pulse', hidden: true },
    { key: 'zmyslony', hidden: true },
    { key: 'settings', hidden: true }, // wymuszane widoczne
  ]);
  assert.equal(merged[0].key, 'clients');
  assert.equal(merged[0].label, 'Kontrahenci');
  assert.equal(merged[0].defaultLabel, 'Klienci');
  assert.equal(merged[1].key, 'pulse');
  assert.equal(merged[1].hidden, true);
  assert.equal(merged.find((m) => m.key === 'settings').hidden, false, 'Ustawienia zawsze widoczne');
  assert.ok(!merged.some((m) => m.key === 'zmyslony'));
  assert.equal(merged.length, panelUi.MENU.length, 'brakujące pozycje doklejone');
  assert.equal(merged.find((m) => m.key === 'dashboard').hidden, false);

  // sanityzacja widżetów: whitelist + duplikaty
  const w = panelUi.sanitizeWidgets([{ key: 'activity', hidden: true }, { key: 'activity' }, { key: 'nope' }]);
  assert.deepEqual(w, [{ key: 'activity', hidden: true }]);
});

test('pulpit: tryb Dostosuj zapisuje układ (snapshot+restore Settings)', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { panel: true } });
  try {
    // pulpit renderuje przycisk Dostosuj i domyślne widżety
    let html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Dostosuj/);
    assert.match(html, /Szybkie akcje/);
    assert.match(html, /Nadchodzące zadania/);

    // zapis układu: aktywność na początku, akcje ukryte
    const layout = [{ key: 'activity', hidden: false }, { key: 'actions', hidden: true }];
    const r = await fetch(`${base}/admin/dashboard/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ layout: JSON.stringify(layout) }),
    });
    assert.equal(r.status, 204);

    // po zapisie: akcje jako placeholder ukrytego, aktywność przed kafelkami
    html = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /ukryty — dane po włączeniu/);
    assert.ok(html.indexOf('Ostatnia aktywność') < html.indexOf('Aktywne transfery'), 'kolejność zapisana');

    // menu boczne: edytor w ustawieniach obecny
    const sHtml = await (await fetch(`${base}/admin/settings`, { headers: { Cookie: cookie } })).text();
    assert.match(sHtml, /menuEditor/);
    assert.match(sHtml, /menuLabel_clients/);
  } finally {
    await prisma.settings.update({ where: { id: 1 }, data: { panel: snap ? snap.panel : null } });
  }
});
