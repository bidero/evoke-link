// Poprawki z przeglądu bezpieczeństwa (razem z wprowadzeniem Turbo w panelu):
// - sesja weryfikowana z bazą przy każdym żądaniu (wyłączenie konta/zmiana roli działa od razu),
// - bootstrap z .env nie wpuszcza pustym hasłem, gdy ADMIN_PASSWORD jest pusty,
// - publiczne endpointy kawałków uploadu wymagają istniejącego, dostępnego linku (i hasła),
// - upload brandingu: tylko rozszerzenia obrazów + zamknięta CSP pod /branding,
// - sanityzacja SVG łapie `<svg/onload=…>` i animacje SMIL.
// HTTP E2E na dev-DB; sprząta własne rekordy.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const config = require('../src/config');
const authService = require('../src/services/auth.service');
const transferService = require('../src/services/transfer.service');
const { sanitizeSvg } = require('../src/utils/svgSanitize');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const cookieOf = (r) => (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
async function login(email, password) {
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return { status: r.status, cookie: cookieOf(r) };
}
const get = (url, cookie) => fetch(`${base}${url}`, { headers: { Cookie: cookie || '' }, redirect: 'manual' });

test('sesja: wyłączenie konta wylogowuje od razu, zmiana roli działa bez ponownego logowania', async () => {
  const email = 'TEST_sec_' + Date.now() + '@example.com';
  const pass = 'tajnehaslo123';
  let user;
  try {
    user = await authService.createUser({ email, password: pass, name: 'Sec Test', role: 'admin' });
    const s = await login(email, pass);
    assert.equal(s.status, 302);
    assert.equal((await get('/admin/settings', s.cookie)).status, 200, 'admin widzi Ustawienia');

    // Odebranie roli admina — ta sama sesja, bez ponownego logowania.
    await authService.updateUser(user.id, { role: 'staff' });
    assert.equal((await get('/admin/settings', s.cookie)).status, 403, 'po zmianie roli: 403 od razu');
    assert.equal((await get('/admin', s.cookie)).status, 200, 'pulpit dalej dostępny');

    // Wyłączenie konta — ta sama sesja ląduje na ekranie logowania.
    await authService.updateUser(user.id, { active: false });
    const r = await get('/admin', s.cookie);
    assert.equal(r.status, 302, 'wyłączone konto: przekierowanie');
    assert.match(r.headers.get('location') || '', /\/admin\/login/);

    // Usunięte konto — to samo.
    await authService.updateUser(user.id, { active: true });
    await prisma.user.delete({ where: { id: user.id } });
    user = null;
    const r2 = await get('/admin', s.cookie);
    assert.equal(r2.status, 302, 'usunięte konto: przekierowanie');
  } finally {
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});

test('bootstrap .env: puste ADMIN_PASSWORD nie wpuszcza pustym hasłem', async () => {
  const saved = { ...config.admin };
  try {
    config.admin.email = 'TEST_boot_' + Date.now() + '@example.com';
    config.admin.password = '';
    config.admin.passwordHash = '';
    assert.equal(await authService.authenticate(config.admin.email, ''), null, 'puste hasło odrzucone');
    config.admin.password = 'haslo-z-env-123';
    assert.ok(await authService.authenticate(config.admin.email, 'haslo-z-env-123'), 'poprawne hasło z .env działa');
    assert.equal(await authService.authenticate(config.admin.email, 'zle'), null, 'złe hasło odrzucone');
  } finally {
    Object.assign(config.admin, saved);
  }
});

function chunkForm(uploadId) {
  const fd = new FormData();
  fd.append('uploadId', uploadId);
  fd.append('fileIndex', '0');
  fd.append('fileName', 'a.txt');
  fd.append('fileType', 'text/plain');
  fd.append('chunkIndex', '0');
  fd.append('totalChunks', '1');
  fd.append('chunk', new Blob([Buffer.from('dane')]), 'chunk');
  return fd;
}

test('publiczne kawałki uploadu: nieznany token 404, hasło bez odblokowania 403, poprawny link 200', async () => {
  const chunksDir = path.join(__dirname, '..', 'storage', 'tmp', 'chunks');
  const id1 = crypto.randomBytes(16).toString('hex');
  const r1 = await fetch(`${base}/upload/nie-ma-takiego-tokenu/chunk`, { method: 'POST', body: chunkForm(id1) });
  assert.equal(r1.status, 404, 'nieznany token /upload');
  assert.ok(!fs.existsSync(path.join(chunksDir, id1)), 'nic nie trafiło na dysk');

  const r2 = await fetch(`${base}/p/nie-ma-takiego-tokenu/chunk`, { method: 'POST', body: chunkForm(id1) });
  assert.equal(r2.status, 404, 'nieznany token /p');

  const locked = await transferService.createUploadRequest({ title: 'TEST_sec_locked_' + Date.now(), password: 'tajne123' });
  const open = await transferService.createUploadRequest({ title: 'TEST_sec_open_' + Date.now() });
  try {
    const isLocked = transferService.requiresPassword(await prisma.transfer.findUnique({ where: { id: locked.id } }));
    if (isLocked) {
      const r3 = await fetch(`${base}/upload/${locked.token}/chunk`, { method: 'POST', body: chunkForm(crypto.randomBytes(16).toString('hex')) });
      assert.equal(r3.status, 403, 'link z hasłem bez odblokowania');
    }
    const id4 = crypto.randomBytes(16).toString('hex');
    const r4 = await fetch(`${base}/upload/${open.token}/chunk`, { method: 'POST', body: chunkForm(id4) });
    assert.equal(r4.status, 200, 'poprawny link przyjmuje kawałek');
    fs.rmSync(path.join(chunksDir, id4), { recursive: true, force: true });
  } finally {
    for (const t of [locked, open]) {
      await prisma.transfer.deleteMany({ where: { id: t.id } });
    }
  }
});

test('branding: plik spoza listy rozszerzeń odrzucony, /branding ma zamkniętą CSP', async () => {
  if (!process.env.ADMIN_PASSWORD) return;
  const a = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const before = new Set(fs.readdirSync(path.join(__dirname, '..', 'public', 'branding')));
  // Nowy klient z „awatarem" .html zadeklarowanym jako image/png (typ MIME podaje przeglądarka).
  const name = 'TEST_sec_avatar_' + Date.now();
  const fd = new FormData();
  fd.append('name', name);
  fd.append('avatar', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'strona.html');
  try {
    await fetch(`${base}/admin/clients`, { method: 'POST', headers: { Cookie: a.cookie }, body: fd, redirect: 'manual' });
    const added = fs.readdirSync(path.join(__dirname, '..', 'public', 'branding')).filter((f) => !before.has(f));
    assert.deepEqual(added.filter((f) => /\.html?$/i.test(f)), [], 'żaden .html nie trafił do public/branding');
    added.forEach((f) => fs.rmSync(path.join(__dirname, '..', 'public', 'branding', f), { force: true }));
    const c = await prisma.client.findFirst({ where: { name } });
    assert.ok(c, 'klient utworzony mimo odrzuconego pliku');
    assert.equal(c.avatarPath, null, 'bez awatara');
  } finally {
    await prisma.client.deleteMany({ where: { name } });
  }
  const r = await fetch(`${base}/branding/.gitkeep`);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /sandbox/, 'CSP z sandboxem');
  assert.match(csp, /default-src 'none'/, 'bez skryptów');
});

test('SVG: `<svg/onload>`, zdarzenia i animacje SMIL usunięte', () => {
  const out = sanitizeSvg('<svg/onload=alert(1)><set attributeName="onmouseover" to="alert(1)"/><rect onclick="x" width="1"/></svg>');
  assert.doesNotMatch(out, /onload|onclick|<set/i);
  assert.match(out, /<rect\s+width="1"\s*\/>/);
});

test('widoki: potwierdzenie usunięcia konta escapowane, przycisk usuwa (submit)', async () => {
  if (!process.env.ADMIN_PASSWORD) return;
  const email = "TEST_o'brien_" + Date.now() + '@example.com';
  const u = await authService.createUser({ email, password: 'tajnehaslo123', role: 'staff' });
  try {
    const a = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const html = await (await get('/admin/users', a.cookie)).text();
    assert.match(html, new RegExp(`<button type="submit" form="del-${u.id}"`), 'przycisk usuwania wysyła formularz');
    assert.doesNotMatch(html, /confirm\('Usunąć konto/, 'brak surowego stringa w confirm()');
  } finally {
    await prisma.user.deleteMany({ where: { id: u.id } });
  }
});

test('Turbo: panel ma konfigurację (root, bez cache/prefetch), Sortable w <head>; portale bez prefetchu', async () => {
  if (!process.env.ADMIN_PASSWORD) return;
  const a = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const html = await (await get('/admin/projects/board', a.cookie)).text();
  const head = html.split('</head>')[0];
  assert.match(head, /<meta name="turbo-root" content="\/admin"/);
  assert.match(head, /<meta name="turbo-cache-control" content="no-cache"/);
  assert.match(head, /<meta name="turbo-prefetch" content="false"/);
  assert.match(head, /src="\/js\/turbo\.js[^"]*" data-turbo-track="reload"/);
  assert.match(head, /src="\/js\/sortable\.min\.js"/, 'Sortable w <head>');
  const body = html.split('</head>')[1];
  assert.doesNotMatch(body, /sortable\.min\.js/, 'żaden widok nie ładuje Sortable w <body>');
  assert.doesNotMatch(body, /location\.reload\(\)/, 'kanban odświeża przez Turbo, nie location.reload');

  // Formularze bez przekierowania (wylogowanie) poza Turbo.
  assert.match(html, /action="\/admin\/logout" data-turbo="false"/);

  // Portal klienta: GET-y ze skutkami — bez pobierania „na zapas" przy najechaniu.
  const pub = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'layouts', 'public.ejs'), 'utf8');
  assert.match(pub, /<meta name="turbo-prefetch" content="false"/);
});

test('strona projektu: tytuł transferu escapowany w liście', async () => {
  if (!process.env.ADMIN_PASSWORD) return;
  const project = await prisma.project.create({ data: { name: 'TEST_sec_proj_' + Date.now(), clientToken: 'secp' + Date.now() } });
  const t = await transferService.createUploadRequest({ title: '<img src=x onerror=alert(1)>', projectId: project.id });
  try {
    const a = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const html = await (await get('/admin/projects/' + project.id, a.cookie)).text();
    assert.doesNotMatch(html, /<img src=x onerror/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  } finally {
    await prisma.transfer.deleteMany({ where: { id: t.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
  }
});
