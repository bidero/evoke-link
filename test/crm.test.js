// CRM: widżet „Do odezwania się" (staleClients) + sekcja „Do zapłaty" w portalu /c.
// UWAGA: test płatności dotyka wiersza Settings — snapshot + restore w finally (wspólna baza dev).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const clientService = require('../src/services/client.service');
const settingsService = require('../src/services/settings.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('staleClients: dawny kontakt na liście, świeży i nieaktywni poza nią', async () => {
  const old = new Date(Date.now() - 40 * 86400000);
  const a = await prisma.client.create({ data: { name: 'CRM Fresh', token: 'crmf_' + Date.now() } });
  const b = await prisma.client.create({ data: { name: 'CRM Stale', token: 'crms_' + Date.now(), createdAt: old } });
  const c = await prisma.client.create({ data: { name: 'CRM Inactive', token: 'crmi_' + Date.now(), status: 'inactive', createdAt: old } });
  try {
    await prisma.event.create({ data: { type: 'viewed', clientId: a.id } });                  // świeży kontakt
    await prisma.event.create({ data: { type: 'viewed', clientId: b.id, createdAt: old } });  // stary kontakt
    await prisma.reminder.create({ data: { title: 'follow-up', dueAt: new Date(), clientId: b.id } });
    const stale = await clientService.staleClients({ days: 30, limit: 1000 });
    const ids = stale.map((s) => s.id);
    assert.ok(ids.includes(b.id), 'stary kontakt na liście');
    assert.ok(!ids.includes(a.id), 'świeży poza listą');
    assert.ok(!ids.includes(c.id), 'nieaktywny poza listą');
    const sb = stale.find((s) => s.id === b.id);
    assert.ok(sb.days >= 39 && sb.days <= 41, 'poprawna liczba dni');
    assert.equal(sb.planned, true, 'otwarte przypomnienie = „zaplanowane"');
  } finally {
    await prisma.reminder.deleteMany({ where: { clientId: { in: [a.id, b.id, c.id] } } });
    await prisma.event.deleteMany({ where: { clientId: { in: [a.id, b.id, c.id] } } });
    await prisma.client.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  }
});

test('QR: payload ZBP zachowuje polskie znaki, generator koduje UTF-8', () => {
  const payment = require('../src/utils/payment');
  const qr = require('../src/utils/qr');
  const payload = payment.zbpPayload({ nip: '526-030-02-91', account: '6'.repeat(26), amountGr: 12345, name: 'Żółć Studió Sp. z o.o. i Wspólnicy', title: 'Rozliczenie — Łukasz' });
  assert.match(payload, /^5260300291\|PL\|6{26}\|012345\|Żółć Studió Sp\. z o\.\|Rozliczenie — Łukasz\|\|\|$/, 'NIP bez kresek, kwota 6 cyfr, odbiorca ucięty do 20 znaków z diakrytykami');
  const svg = qr.svg(payload, { cell: 2 });
  assert.ok(svg.startsWith('<svg'), 'QR z polskimi znakami renderuje się bez błędu');
});

test('portal /c: „Do zapłaty" — pozycje brutto, suma, dane do przelewu i QR', async () => {
  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { pdf: true } });
  const cl = await prisma.client.create({ data: { name: 'CRM Pay', token: 'crmp_' + Date.now() } });
  let project;
  try {
    await settingsService.update({
      pdf: { template: 'standard', docType: 'rozliczenie', logoHeight: 48, seller: { name: 'Evoke Studio', address: '', nip: '5260300291', bank: '61 1090 1014 0000 0712 1981 2874' } },
    });
    project = await prisma.project.create({ data: { name: 'CRM PayProj', clientId: cl.id, clientToken: 'crmpp_' + Date.now() } });
    await prisma.charge.create({ data: { clientId: cl.id, label: 'Pozycja wprost', amount: 10000, vatRate: 23 } });          // 123,00 zł brutto
    await prisma.charge.create({ data: { projectId: project.id, label: 'Pozycja projektu', amount: 20000, vatRate: 23 } });  // 246,00 zł brutto
    await prisma.charge.create({ data: { clientId: cl.id, label: 'Oplacona-pozycja', amount: 5000, paidAt: new Date() } });  // pomijana

    const html = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.match(html, /Do zapłaty/);
    assert.match(html, /Pozycja wprost/);
    assert.match(html, /Pozycja projektu/, 'pozycja z projektu klienta też widoczna');
    assert.doesNotMatch(html, /Oplacona-pozycja/, 'opłacone pomijane');
    assert.match(html, /123,00/);
    assert.match(html, /369,00/, 'suma brutto (123 + 246)');
    assert.match(html, /Dane do przelewu/);
    assert.match(html, /1090 1014/, 'numer konta z ustawień');
    assert.match(html, /Rozliczenie — CRM Pay/, 'gotowy tytuł przelewu');
    assert.match(html, /pokaż kod QR/i, 'QR dostępny (konto = 26 cyfr)');

    // przełącznik: pdf.portalBilling = false chowa całą sekcję
    const cur = (await settingsService.get()).pdf;
    await settingsService.update({ pdf: { ...cur, portalBilling: false } });
    const html2 = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.doesNotMatch(html2, /Do zapłaty/, 'sekcja wyłączona przełącznikiem');
  } finally {
    await prisma.charge.deleteMany({ where: { OR: [{ clientId: cl.id }, { projectId: project ? project.id : -1 }] } });
    if (project) {
      await prisma.event.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
    await prisma.settings.update({ where: { id: 1 }, data: { pdf: snap ? snap.pdf : null } });
  }
});
