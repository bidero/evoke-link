// Historia wysłanych maili: każdy wpis `email_sent` niesie rodzaj, adresata i REALNY
// temat (ten, który poszedł do klienta — także z szablonu w Ustawieniach → E-mail).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const events = require('../src/services/event.service');
const mail = require('../src/services/mail.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('mail.send zwraca temat i adresata (żeby historia mogła je zapisać)', async () => {
  // Bez SMTP idzie ścieżka „dev" — musi zwracać to samo, inaczej historia byłaby pusta
  // na środowisku bez skonfigurowanej poczty.
  const info = await mail.sendTest({ to: 'ktos@przyklad.pl' });
  assert.equal(info.to, 'ktos@przyklad.pl');
  assert.ok(info.subject, 'temat zwrócony');
});

test('events.emailSent: spójny format „Rodzaj → adresat · „temat"" + meta', async () => {
  const cl = await prisma.client.create({ data: { name: 'MAILLOG ' + Date.now(), token: 'mlt_' + Date.now() } });
  try {
    await events.emailSent({
      kind: 'Oferta', to: 'jan@firma.pl',
      info: { to: 'jan@firma.pl', subject: 'Evoke LINK — oferta: Rebranding' },
      clientId: cl.id,
    });
    let ev = await prisma.event.findFirst({ where: { clientId: cl.id }, orderBy: { id: 'desc' } });
    assert.equal(ev.type, 'email_sent');
    assert.equal(ev.message, 'Oferta → jan@firma.pl · „Evoke LINK — oferta: Rebranding"');
    assert.deepEqual(JSON.parse(ev.meta), { kind: 'Oferta', to: 'jan@firma.pl', subject: 'Evoke LINK — oferta: Rebranding' });

    // `extra` = dopisek w nawiasie (liczba pozycji, kwota, nazwa załącznika…)
    await events.emailSent({
      kind: 'Przypomnienie o płatności', to: 'jan@firma.pl',
      info: { subject: 'Evoke LINK — przypomnienie' }, extra: '3 poz., 1500.00 zł', clientId: cl.id,
    });
    ev = await prisma.event.findFirst({ where: { clientId: cl.id }, orderBy: { id: 'desc' } });
    assert.equal(ev.message, 'Przypomnienie o płatności → jan@firma.pl · „Evoke LINK — przypomnienie" (3 poz., 1500.00 zł)');

    // Adresat brany z `info`, gdy nie podano go wprost; brak tematu nie psuje wpisu.
    await events.emailSent({ kind: 'Panel projektu', info: { to: 'z-info@firma.pl' }, clientId: cl.id });
    ev = await prisma.event.findFirst({ where: { clientId: cl.id }, orderBy: { id: 'desc' } });
    assert.equal(ev.message, 'Panel projektu → z-info@firma.pl');
    assert.equal(JSON.parse(ev.meta).subject, null);
  } finally {
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});

test('wysyłka linku do transferu zapisuje w historii rodzaj, adresata i temat', async (t) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return t.skip('brak ADMIN_PASSWORD w .env');
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: process.env.ADMIN_EMAIL, password }), redirect: 'manual' });
  const cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');

  const transferService = require('../src/services/transfer.service');
  const fs = require('fs');
  const tmp = path.join('storage', 'tmp', 'mail-log-' + Date.now());
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from('x'));
  const tr = await transferService.createOutgoingTransfer({
    title: 'Zdjęcia z sesji', uploadedFiles: [{ originalname: 'a.txt', path: tmp, size: 1, mimetype: 'text/plain' }],
  });
  try {
    await fetch(`${base}/admin/transfers/${tr.id}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ email: 'klient@przyklad.pl' }), redirect: 'manual',
    });
    await new Promise((res) => setTimeout(res, 200));

    const ev = await prisma.event.findFirst({ where: { transferId: tr.id, type: 'email_sent' }, orderBy: { id: 'desc' } });
    assert.ok(ev, 'zdarzenie zapisane');
    assert.match(ev.message, /^Link do transferu → klient@przyklad\.pl · „.+"$/, 'rodzaj + adresat + temat');
    assert.match(ev.message, /Zdjęcia z sesji/, 'temat niesie tytuł transferu');
    const meta = JSON.parse(ev.meta);
    assert.equal(meta.kind, 'Link do transferu');
    assert.equal(meta.to, 'klient@przyklad.pl');
    assert.ok(meta.subject);
  } finally {
    const t2 = await transferService.getById(tr.id);
    if (t2) await transferService.remove(t2);
  }
});
