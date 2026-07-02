// Onboarding: jednorazowy link /onboard/:token — klient sam uzupełnia dane CRM.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const clientService = require('../src/services/client.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, fields) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' });

test('onboarding: generacja → formularz → zapis → jednorazowość → wygasanie → regeneracja', async () => {
  const c1 = await prisma.client.create({ data: { name: 'OnbTest ' + Date.now(), token: 'onbc1_' + Date.now() } });
  const c2 = await prisma.client.create({ data: { name: 'OnbTest2 ' + Date.now(), token: 'onbc2_' + Date.now(), email: 'stale@example.com' } });
  try {
    // generacja: token + ważność ~7 dni
    let cl = await clientService.generateOnboarding(c1.id);
    assert.ok(cl.onboardingToken, 'token wygenerowany');
    const days = (new Date(cl.onboardingExpiresAt) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1, 'ważny ~7 dni');
    assert.equal(clientService.onboardingState(cl), 'active');

    // formularz się renderuje
    const html = await (await fetch(`${base}/onboard/${cl.onboardingToken}`)).text();
    assert.match(html, /Uzupełnij swoje dane/);
    assert.match(html, /Dane firmowe/);

    // zapis danych (e-mail edytowalny, bo w kartotece pusty; NIP normalizowany)
    const r = await post(`${base}/onboard/${cl.onboardingToken}`, {
      company: 'ACME Sp. z o.o.', nip: '123-456-32-18', address: 'ul. Testowa 1, 00-001 Warszawa',
      firstName: 'Jan', lastName: 'Kowalski', phone: '+48 600 700 800', email: 'jan@example.com',
    });
    assert.equal(r.status, 302);
    await wait(200);
    cl = await prisma.client.findUnique({ where: { id: c1.id } });
    assert.equal(cl.company, 'ACME Sp. z o.o.');
    assert.equal(cl.nip, '1234563218', 'NIP bez kresek i spacji');
    assert.equal(cl.firstName, 'Jan');
    assert.equal(cl.email, 'jan@example.com', 'e-mail zapisany, bo był pusty');
    assert.ok(cl.onboardingCompletedAt, 'oznaczony jako wypełniony');
    assert.equal(clientService.onboardingState(cl), 'completed');

    // event 'onboarded' w osi czasu
    const ev = await prisma.event.findFirst({ where: { clientId: c1.id, type: 'onboarded' } });
    assert.ok(ev, 'event onboarded zalogowany');

    // ponowny GET → podziękowanie (bez formularza), ponowny POST → dane nietknięte
    const html2 = await (await fetch(`${base}/onboard/${cl.onboardingToken}`)).text();
    assert.match(html2, /Dziękujemy/);
    assert.doesNotMatch(html2, /Dane firmowe/);
    const r2 = await post(`${base}/onboard/${cl.onboardingToken}`, { company: 'HACK', firstName: 'Inny' });
    assert.equal(r2.status, 302, 'idempotentny redirect');
    const after2 = await prisma.client.findUnique({ where: { id: c1.id } });
    assert.equal(after2.company, 'ACME Sp. z o.o.', 'dane niezmienione po ponownym POST');

    // klient z e-mailem w kartotece: formularz nie nadpisuje adresu
    const cl2 = await clientService.generateOnboarding(c2.id);
    await post(`${base}/onboard/${cl2.onboardingToken}`, { company: 'Druga', email: 'nowy@example.com' });
    await wait(200);
    assert.equal((await prisma.client.findUnique({ where: { id: c2.id } })).email, 'stale@example.com', 'e-mail z kartoteki nietknięty');

    // wygasły link → 410 na GET i POST
    await prisma.client.update({ where: { id: c1.id }, data: { onboardingExpiresAt: new Date(Date.now() - 1000), onboardingCompletedAt: null } });
    const expired = await prisma.client.findUnique({ where: { id: c1.id } });
    assert.equal(clientService.onboardingState(expired), 'expired');
    assert.equal((await fetch(`${base}/onboard/${expired.onboardingToken}`)).status, 410);
    assert.equal((await post(`${base}/onboard/${expired.onboardingToken}`, { company: 'X' })).status, 410);

    // regeneracja: stary token przestaje działać, nowy jest aktywny
    const oldToken = expired.onboardingToken;
    const fresh = await clientService.generateOnboarding(c1.id);
    assert.notEqual(fresh.onboardingToken, oldToken);
    assert.equal((await fetch(`${base}/onboard/${oldToken}`)).status, 404, 'stary link martwy');
    assert.equal((await fetch(`${base}/onboard/${fresh.onboardingToken}`)).status, 200, 'nowy link działa');
  } finally {
    await prisma.event.deleteMany({ where: { clientId: { in: [c1.id, c2.id] } } });
    await prisma.client.deleteMany({ where: { id: { in: [c1.id, c2.id] } } });
  }
});
