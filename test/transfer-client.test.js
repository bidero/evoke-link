// Transfer przypisany wprost do KLIENTA (dotąd tylko przez projekt) + lista transferów z klientem
// i informacją o wysyłce mailem + zakładka „Cała aktywność" w powiadomieniach.
// Do tego regresje z przeglądu bezpieczeństwa (1.5.0): bramka admina dla /admin/update,
// link uploadu niedostępny pod /t/, podgląd bez typu treści od klienta, hasło przy wiadomościach.
// HTTP E2E na dev-DB; sprząta własne rekordy.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const authService = require('../src/services/auth.service');
const transferService = require('../src/services/transfer.service');
const events = require('../src/services/event.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const cookieOf = (r) => (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
async function login(email, password) {
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return cookieOf(r);
}
const get = (url, cookie) => fetch(`${base}${url}`, { headers: { Cookie: cookie || '' }, redirect: 'manual' });
const post = (url, cookie, data) => fetch(`${base}${url}`, {
  method: 'POST', headers: { Cookie: cookie || '', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data), redirect: 'manual',
});

// Konto admina na czas testu (nie zależy od .env).
async function withAdmin(fn) {
  const email = 'TEST_tc_' + Date.now() + '@example.com';
  const user = await authService.createUser({ email, password: 'tajnehaslo123', name: 'TC', role: 'admin' });
  try { return await fn(await login(email, 'tajnehaslo123')); } finally { await prisma.user.deleteMany({ where: { id: user.id } }); }
}

// Plik na dysku podpięty pod transfer (bez uploadu przez HTTP).
function tmpFile(content) {
  const p = path.join(os.tmpdir(), 'evoke-tc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.writeFileSync(p, content);
  return p;
}

test('transfer bez projektu przypisany do klienta: zapis, lista z filtrem, wysyłka mailem, kartoteka', async () => {
  const stamp = Date.now();
  const cl = await prisma.client.create({ data: { name: 'TEST_tc_Klient ' + stamp, email: 'tc' + stamp + '@example.com', token: 'tc' + stamp } });
  const other = await prisma.client.create({ data: { name: 'TEST_tc_Inny ' + stamp, token: 'tco' + stamp } });
  const proj = await prisma.project.create({ data: { name: 'TEST_tc_Projekt ' + stamp, clientToken: 'tcp' + stamp, clientId: other.id } });
  const ids = [];
  try {
    await withAdmin(async (cookie) => {
      // 1) Link uploadu przypisany WPROST do klienta (bez projektu).
      let r = await post('/admin/transfers/upload', cookie, { title: 'TEST_tc_upload ' + stamp, clientId: String(cl.id), projectId: '' });
      assert.equal(r.status, 302);
      const t1 = await prisma.transfer.findFirst({ where: { title: 'TEST_tc_upload ' + stamp } });
      ids.push(t1.id);
      assert.equal(t1.clientId, cl.id, 'klient zapisany bez projektu');
      assert.equal(t1.projectId, null);

      // 2) Projekt z innym klientem wygrywa — transfer w projekcie należy do klienta projektu.
      r = await post('/admin/transfers/upload', cookie, { title: 'TEST_tc_mix ' + stamp, clientId: String(cl.id), projectId: String(proj.id) });
      const t2 = await prisma.transfer.findFirst({ where: { title: 'TEST_tc_mix ' + stamp } });
      ids.push(t2.id);
      assert.equal(t2.clientId, other.id, 'klient z projektu, nie z selecta');

      // 3) Edycja: zmiana klienta (bez projektu).
      r = await post(`/admin/transfers/${t1.id}`, cookie, { title: 'TEST_tc_upload ' + stamp, clientId: String(other.id), projectId: '' });
      assert.equal(r.status, 302);
      assert.equal((await prisma.transfer.findUnique({ where: { id: t1.id } })).clientId, other.id);
      await post(`/admin/transfers/${t1.id}`, cookie, { title: 'TEST_tc_upload ' + stamp, clientId: String(cl.id), projectId: '' });

      // 4) Wysyłka mailem (tryb dev bez SMTP też loguje `email_sent`) → lista pokazuje kiedy i komu.
      r = await post(`/admin/transfers/${t1.id}/send`, cookie, { email: cl.email });
      assert.match(r.headers.get('location') || '', /mail=sent/);
      const list = await (await get(`/admin/transfers?client=${cl.id}`, cookie)).text();
      assert.match(list, new RegExp('TEST_tc_upload ' + stamp), 'filtr po kliencie pokazuje transfer');
      assert.doesNotMatch(list, new RegExp('TEST_tc_mix ' + stamp), 'transfer innego klienta odfiltrowany');
      assert.match(list, new RegExp('wysłano [^<]*→ ' + cl.email.replace('.', '\\.')), 'data wysyłki + adresat pod tytułem');
      assert.match(list, new RegExp('TEST_tc_Klient ' + stamp), 'nazwa klienta pod tytułem');

      // Strona transferu: chip klienta + historia wysyłek + e-mail klienta w polu.
      const show = await (await get(`/admin/transfers/${t1.id}`, cookie)).text();
      assert.match(show, new RegExp(`/admin/clients/${cl.id}"`));
      assert.match(show, /Wysłano e-mailem/);

      // 5) Kartoteka klienta: transfer bez projektu widoczny + przyciski tworzenia transferu.
      const card = await (await get(`/admin/clients/${cl.id}?tab=transfery`, cookie)).text();
      assert.match(card, new RegExp('TEST_tc_upload ' + stamp));
      assert.match(card, /bez projektu/);
      assert.match(card, new RegExp(`/admin/transfers/new\\?client=${cl.id}`));
      assert.match(card, new RegExp(`/admin/transfers/new-upload\\?client=${cl.id}`));

      // 6) Formularz z ?client= ma klienta wybranego.
      const form = await (await get(`/admin/transfers/new?client=${cl.id}&from=client:${cl.id}`, cookie)).text();
      assert.match(form, new RegExp(`<option value="${cl.id}" selected`));
      assert.match(form, /'clientId'\]/, 'clientId w polach wysyłanych przez XHR (GOTCHA formularza uploadu)');
      assert.match(form, /Wróć do klienta/);

      // 7) Zmiana klienta projektu przenosi jego transfery.
      await prisma.project.update({ where: { id: proj.id }, data: { clientId: other.id } });
      const projectService = require('../src/services/project.service');
      await projectService.update(proj.id, { name: proj.name, clientId: cl.id });
      assert.equal((await prisma.transfer.findUnique({ where: { id: t2.id } })).clientId, cl.id, 'transfery idą za klientem projektu');
    });
  } finally {
    await prisma.event.deleteMany({ where: { transferId: { in: ids } } });
    await prisma.transfer.deleteMany({ where: { id: { in: ids } } });
    await prisma.event.deleteMany({ where: { OR: [{ projectId: proj.id }, { clientId: { in: [cl.id, other.id] } }] } });
    await prisma.project.delete({ where: { id: proj.id } });
    await prisma.client.deleteMany({ where: { id: { in: [cl.id, other.id] } } });
  }
});

test('powiadomienia: zakładka „Cała aktywność" — wysłane e-maile, filtr, wyszukiwanie po adresie', async () => {
  const stamp = Date.now();
  const addr = `aktyw${stamp}@example.com`;
  await events.emailSent({ kind: 'Rozliczenie (PDF)', to: addr, info: { subject: 'TEST_tc temat ' + stamp } });
  await events.log({ type: 'created', message: 'TEST_tc utworzono ' + stamp });
  try {
    await withAdmin(async (cookie) => {
      assert.equal((await get('/admin/notifications?tab=activity')).status, 302, 'wymaga logowania');
      const all = await (await get(`/admin/notifications?tab=activity&q=${stamp}`, cookie)).text();
      assert.match(all, new RegExp(addr.replace('.', '\\.')), 'wysłany e-mail w pełnej historii');
      assert.match(all, new RegExp('TEST_tc utworzono ' + stamp), 'akcja agencji też');
      const mails = await (await get(`/admin/notifications?tab=activity&filter=email&q=${stamp}`, cookie)).text();
      assert.match(mails, new RegExp('TEST_tc temat ' + stamp));
      assert.doesNotMatch(mails, new RegExp('TEST_tc utworzono ' + stamp), 'filtr e-maili ukrywa inne zdarzenia');
      const byAddr = await (await get(`/admin/notifications?tab=activity&q=${encodeURIComponent(addr)}`, cookie)).text();
      assert.match(byAddr, /1 wpis\b/, 'szukanie po adresie e-mail');
      // Lista powiadomień (domyślna zakładka) dalej pokazuje tylko typy „dzwonka".
      const notif = await (await get('/admin/notifications', cookie)).text();
      assert.doesNotMatch(notif, new RegExp('TEST_tc temat ' + stamp));
      assert.match(notif, /Cała aktywność/);
      // Nieznany filtr / strona spoza zakresu → bezpieczne wartości domyślne.
      assert.equal((await get('/admin/notifications?tab=activity&filter=zzz&page=9999', cookie)).status, 200);
    });
  } finally {
    await prisma.event.deleteMany({ where: { message: { contains: String(stamp) } } });
  }
});

test('bezpieczeństwo: pracownik nie ma dostępu do aktualizatora', async () => {
  const email = 'TEST_tc_staff_' + Date.now() + '@example.com';
  const user = await authService.createUser({ email, password: 'tajnehaslo123', name: 'Staff', role: 'staff' });
  try {
    const cookie = await login(email, 'tajnehaslo123');
    // GET status (bez skutków ubocznych) — gdyby bramka znów była za trasami, dostałby 200.
    assert.equal((await get('/admin/update/status', cookie)).status, 403);
    assert.equal((await post('/admin/update/notify', cookie, {})).status, 403);
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});

test('bezpieczeństwo: token linku uploadu nie otwiera listy plików pod /t/', async () => {
  const t = await transferService.createUploadRequest({ title: 'TEST_tc_incoming_' + Date.now() });
  try {
    const up = await transferService.addFiles(t, [{ originalname: 'od-klienta.txt', path: tmpFile('tajne dane klienta'), size: 18, mimetype: 'text/plain' }]);
    const f = up.files[0];
    assert.equal((await get(`/upload/${t.token}`)).status, 200, 'link uploadu działa normalnie');
    assert.equal((await get(`/t/${t.token}`)).status, 404, 'ten sam token pod /t/ = nie znaleziono');
    assert.equal((await get(`/t/${t.token}/file/${f.id}`)).status, 404, 'pobranie pliku zablokowane');
    assert.equal((await get(`/t/${t.token}/zip`)).status, 404, 'ZIP zablokowany');
    assert.equal((await get(`/t/${t.token}/wiadomosci/poll`)).status, 404);
  } finally {
    await transferService.remove(t);
  }
});

test('bezpieczeństwo: podgląd nie ufa typowi MIME od klienta (brak XSS przez „obraz" text/html)', async () => {
  const t = await transferService.createUploadRequest({ title: 'TEST_tc_xss_' + Date.now() });
  try {
    const html = '<html><script>alert(document.cookie)</script></html>';
    const up = await transferService.addFiles(t, [{ originalname: 'zdjecie.png', path: tmpFile(html), size: html.length, mimetype: 'text/html' }]);
    await withAdmin(async (cookie) => {
      const r = await get(`/admin/transfers/${t.id}/preview/${up.files[0].id}`, cookie);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png', 'typ z rozszerzenia, nie od klienta');
      assert.match(r.headers.get('content-security-policy') || '', /sandbox/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    });
  } finally {
    await transferService.remove(t);
  }
});

test('bezpieczeństwo: link z hasłem nie przyjmuje wiadomości bez odblokowania', async () => {
  const t = await transferService.createUploadRequest({ title: 'TEST_tc_pwd_' + Date.now(), password: 'tajne123' });
  try {
    const r = await post(`/upload/${t.token}/message`, '', { body: 'spam ' + t.token });
    assert.equal(r.status, 302);
    assert.equal(await prisma.message.count({ where: { transferId: t.id } }), 0, 'wiadomość nie zapisana');
  } finally {
    await prisma.message.deleteMany({ where: { transferId: t.id } });
    await transferService.remove(t);
  }
});
