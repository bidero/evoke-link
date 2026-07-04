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

test('wskaźniki 360°: LTV, śr. czas płatności, seria 12 miesięcy', () => {
  const now = new Date(2026, 5, 15); // czerwiec 2026
  const charges = [
    { amount: 10000, vatRate: 23, date: new Date(2026, 5, 1), paidAt: new Date(2026, 5, 8) },   // brutto 12300, 7 dni (czerwiec)
    { amount: 20000, vatRate: null, date: new Date(2026, 4, 1), paidAt: new Date(2026, 4, 11) }, // brutto 20000, 10 dni (maj)
    { amount: 5000, vatRate: 0, date: new Date(2026, 5, 1), paidAt: null },                      // nieopłacona — pomijana
  ];
  const m = clientService.clientMetrics(charges, now);
  assert.equal(m.ltv, 32300, 'LTV = suma zapłaconego brutto');
  assert.equal(m.paidCount, 2);
  assert.equal(m.avgPayDays, 9, 'średnia (7+10)/2 zaokrąglona');
  assert.equal(m.chart.length, 12);
  assert.equal(m.chart[11].current, true);
  assert.equal(m.chart[11].label, 'cze');
  assert.equal(m.chart[11].value, 12300, 'bieżący miesiąc = czerwcowa wpłata');
  assert.equal(m.chart[10].value, 20000, 'poprzedni miesiąc = majowa wpłata');
  assert.equal(m.chartMax, 20000);

  // bez zapłaconych pozycji: zera, brak średniej
  const empty = clientService.clientMetrics([{ amount: 5000, paidAt: null }], now);
  assert.equal(empty.ltv, 0);
  assert.equal(empty.avgPayDays, null);
});

test('QR: payload ZBP zachowuje polskie znaki i pełną nazwę odbiorcy (do 40 znaków)', () => {
  const payment = require('../src/utils/payment');
  const qr = require('../src/utils/qr');
  const payload = payment.zbpPayload({ nip: '526-030-02-91', account: '6'.repeat(26), amountGr: 12345, name: 'Żółć Studió Sp. z o.o. i Wspólnicy', title: 'Rozliczenie — Łukasz' });
  assert.match(payload, /^5260300291\|PL\|6{26}\|012345\|Żółć Studió Sp\. z o\.o\. i Wspólnicy\|Rozliczenie — Łukasz\|\|\|$/, 'NIP bez kresek, kwota 6 cyfr, PEŁNA nazwa odbiorcy z diakrytykami (34 znaki < 40)');
  const long = payment.zbpPayload({ account: '6'.repeat(26), amountGr: 1, name: 'X'.repeat(50), title: 't' });
  assert.match(long, /\|X{40}\|/, 'powyżej 40 znaków nazwa jest ucinana');
  assert.ok(long.length <= 160, 'całość payloadu w limicie ZBP (160)');
  const svg = qr.svg(payload, { cell: 2 });
  assert.ok(svg.startsWith('<svg'), 'QR z polskimi znakami renderuje się bez błędu');
});

test('portal /c: „Zgłoś wpłatę" — event + anty-duplikat + przełącznik sekcji', async () => {
  const snap = await prisma.settings.findUnique({ where: { id: 1 }, select: { pdf: true } });
  const cl = await prisma.client.create({ data: { name: 'CRM Declare', token: 'crmd_' + Date.now() } });
  try {
    const cur = (await settingsService.get()).pdf;
    await settingsService.update({ pdf: { ...cur, portalBilling: true } });
    await prisma.charge.create({ data: { clientId: cl.id, label: 'Poz. do wpłaty', amount: 10000 } });

    let html = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.match(html, /Zgłoś wykonanie przelewu/, 'przycisk widoczny przy zaległościach');

    // zgłoszenie → redirect ?paid=1, event paid_declared
    const r = await fetch(`${base}/c/${cl.token}/paid`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.ok(r.headers.get('location').includes('paid=1'));
    assert.equal(await prisma.event.count({ where: { clientId: cl.id, type: 'paid_declared' } }), 1);

    // chip zamiast przycisku + anty-duplikat (7 dni)
    html = await (await fetch(`${base}/c/${cl.token}`)).text();
    assert.match(html, /Zgłoszono wpłatę/, 'chip po zgłoszeniu');
    assert.doesNotMatch(html, /Zgłoś wykonanie przelewu/, 'przycisk schowany');
    await fetch(`${base}/c/${cl.token}/paid`, { method: 'POST', redirect: 'manual' });
    assert.equal(await prisma.event.count({ where: { clientId: cl.id, type: 'paid_declared' } }), 1, 'bez duplikatu');

    // wyłączona sekcja → POST nie tworzy zdarzenia
    await prisma.event.deleteMany({ where: { clientId: cl.id, type: 'paid_declared' } });
    await settingsService.update({ pdf: { ...cur, portalBilling: false } });
    await fetch(`${base}/c/${cl.token}/paid`, { method: 'POST', redirect: 'manual' });
    assert.equal(await prisma.event.count({ where: { clientId: cl.id, type: 'paid_declared' } }), 0, 'sekcja wyłączona = brak zgłoszeń');
  } finally {
    await prisma.charge.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
    await prisma.settings.update({ where: { id: 1 }, data: { pdf: snap ? snap.pdf : null } });
  }
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
