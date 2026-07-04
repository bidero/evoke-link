// Oferty: parsowanie pozycji, sumy, akceptacja (→ Charge + kanban) / odrzucenie, /o/:token.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const offerService = require('../src/services/offer.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, fields) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' });

test('oferty: parsowanie pozycji i sumy brutto', () => {
  const items = offerService.parseItems('Projekt | 3000 | 23\nWdrożenie | 2500\nSesja | 800 | 23 | 2\n\n| brak etykiety');
  assert.equal(items.length, 3, 'puste linie i bez etykiety pomijane');
  assert.deepEqual(items[0], { label: 'Projekt', amount: 300000, vatRate: 23, qty: 1, position: 0 });
  assert.equal(items[1].vatRate, null, 'bez VAT gdy nie podano');
  assert.equal(items[2].qty, 2);
  // sumy: 3000*1.23 + 2500 + (800*2)*1.23 = 3690 + 2500 + 1968 = 8158 zł
  const t = offerService.totals(items);
  assert.equal(t.net, 300000 + 250000 + 160000);
  assert.equal(t.gross, 369000 + 250000 + 196800);
});

test('oferty: akceptacja tworzy Charge + rusza projekt lead→active + event', async () => {
  const cl = await prisma.client.create({ data: { name: 'Oferta AC ' + Date.now(), token: 'offc_' + Date.now() } });
  const pr = await prisma.project.create({ data: { name: 'Projekt oferty', clientId: cl.id, stage: 'lead' } });
  try {
    const offer = await offerService.create(cl.id, { projectId: pr.id, title: 'Wycena www', itemsText: 'Projekt | 3000 | 23\nWdrożenie | 2500 | 23' });
    assert.ok(offer && offer.items.length === 2, 'oferta z pozycjami');
    assert.equal(offerService.state(offer), 'open');

    // GET publicznej strony
    const html = await (await fetch(`${base}/o/${offer.token}`)).text();
    assert.match(html, /Wycena www/);
    assert.match(html, /Akceptuję ofertę/);

    // odrzucenie bez powodu → 400 (walidacja)
    const bad = await post(`${base}/o/${offer.token}/decision`, { decision: 'rejected', comment: '' });
    assert.equal(bad.status, 400);

    // akceptacja
    const ok = await post(`${base}/o/${offer.token}/decision`, { decision: 'accepted', name: 'Jan Klient' });
    assert.equal(ok.status, 302);
    await wait(250);

    const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
    assert.equal(fresh.status, 'accepted');
    assert.equal(fresh.decisionName, 'Jan Klient');

    // pozycje trafiły do Charge (projektowe: projectId ustawione, clientId null)
    const charges = await prisma.charge.findMany({ where: { projectId: pr.id } });
    assert.equal(charges.length, 2, 'dwie pozycje z oferty');
    assert.ok(charges.every((c) => c.vatRate === 23));

    // projekt ruszył z lead na active
    assert.equal((await prisma.project.findUnique({ where: { id: pr.id } })).stage, 'active');

    // event offer_accepted
    assert.ok(await prisma.event.findFirst({ where: { clientId: cl.id, type: 'offer_accepted' } }));

    // ponowna decyzja nie zmienia stanu (idempotencja: już nie 'open')
    const again = await offerService.decide(fresh, { decision: 'rejected', comment: 'x' });
    assert.equal(again.ok, false);
  } finally {
    await prisma.charge.deleteMany({ where: { projectId: pr.id } });
    await prisma.offerItem.deleteMany({ where: { offer: { clientId: cl.id } } });
    await prisma.offer.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { OR: [{ clientId: cl.id }, { projectId: pr.id }] } });
    await prisma.project.delete({ where: { id: pr.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});

test('lejek: pipeline agreguje wartość, sortuje po terminie, liczy skuteczność', async () => {
  const cl = await prisma.client.create({ data: { name: 'Lejek ' + Date.now(), token: 'plc_' + Date.now() } });
  const mk = (title, status, validUntil, amount, vat) => prisma.offer.create({
    data: { clientId: cl.id, token: 'plt_' + Math.random().toString(36).slice(2), title, status, validUntil, items: { create: [{ label: 'poz', amount, vatRate: vat, qty: 1, position: 0 }] } },
  });
  try {
    await mk('A open', 'open', null, 100000, 23);                              // brutto 123000, bez terminu
    await mk('B soon', 'open', new Date(Date.now() + 3 * 86400000), 200000, null); // brutto 200000, wygasa za 3 dni
    await mk('C acc', 'accepted', null, 50000, null);
    await mk('D rej', 'rejected', null, 10000, null);
    await mk('E exp', 'open', new Date(Date.now() - 86400000), 70000, null);   // otwarta po terminie → expired

    const pl = await offerService.pipeline();
    const mine = (arr) => arr.filter((o) => o.clientId === cl.id);

    const myOpen = mine(pl.open);
    assert.equal(myOpen.length, 2, 'dwie otwarte (bez wygasłej)');
    assert.equal(myOpen[0].title, 'B soon', 'sortowanie: najbliższy termin pierwszy');
    assert.equal(myOpen.reduce((s, o) => s + o.gross, 0), 123000 + 200000);

    const myExp = mine(pl.expired);
    assert.equal(myExp.length, 1);
    assert.equal(myExp[0].title, 'E exp');

    assert.ok(pl.expiringCount >= 1, 'B liczy się do wygasających w 7 dni');
    assert.ok(pl.openValue >= 323000, 'wartość lejka obejmuje moje otwarte');
    assert.ok(typeof pl.stats.winRate === 'number', 'skuteczność policzona (są rozstrzygnięte)');
  } finally {
    await prisma.offerItem.deleteMany({ where: { offer: { clientId: cl.id } } });
    await prisma.offer.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});

test('oferty: odrzucenie z komentarzem + wygasła oferta', async () => {
  const cl = await prisma.client.create({ data: { name: 'Oferta RJ ' + Date.now(), token: 'offr_' + Date.now() } });
  try {
    const offer = await offerService.create(cl.id, { title: 'Wycena', itemsText: 'Poz | 1000' });
    const r = await post(`${base}/o/${offer.token}/decision`, { decision: 'rejected', comment: 'Za drogo, poproszę taniej' });
    assert.equal(r.status, 302);
    await wait(200);
    const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
    assert.equal(fresh.status, 'rejected');
    assert.match(fresh.decisionComment, /Za drogo/);
    assert.equal((await prisma.charge.count({ where: { clientId: cl.id } })), 0, 'odrzucenie nie tworzy pozycji');
    assert.ok(await prisma.event.findFirst({ where: { clientId: cl.id, type: 'offer_rejected' } }));

    // wygasła oferta: GET pokazuje „wygasła", decyzja odrzucona
    const off2 = await offerService.create(cl.id, { title: 'Stara', itemsText: 'Poz | 500', validUntil: new Date(Date.now() - 86400000) });
    assert.equal(offerService.state(off2), 'expired');
    const html = await (await fetch(`${base}/o/${off2.token}`)).text();
    assert.match(html, /wygasła/i);
    const late = await offerService.decide(off2, { decision: 'accepted' });
    assert.equal(late.ok, false, 'wygasłej nie da się zaakceptować');
  } finally {
    await prisma.offerItem.deleteMany({ where: { offer: { clientId: cl.id } } });
    await prisma.offer.deleteMany({ where: { clientId: cl.id } });
    await prisma.event.deleteMany({ where: { clientId: cl.id } });
    await prisma.charge.deleteMany({ where: { clientId: cl.id } });
    await prisma.client.delete({ where: { id: cl.id } });
  }
});
