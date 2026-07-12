// Nawigacja portali klienta (Settings.layout.portalNav): zakładki/menu boczne na /c i /p.
// UWAGA: test dotyka wiersza Settings — snapshot + restore przez settingsService (odświeża cache).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const settingsService = require('../src/services/settings.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const tok = () => crypto.randomBytes(16).toString('hex');

test('portalNav: tabs/side na /c i /p, none = stos, walidacja zapisu', async () => {
  const snapLayout = (await settingsService.get()).layout;
  let client, project, charge;
  try {
    client = await prisma.client.create({ data: { name: 'Test PortalNav', token: tok() } });
    project = await prisma.project.create({ data: { name: 'Projekt PortalNav', clientToken: tok(), clientId: client.id } });
    // druga sekcja na /c (Do zapłaty) — nierozliczona pozycja
    charge = await prisma.charge.create({ data: { clientId: client.id, label: 'Poz. testowa', amount: 12300 } });

    // none (domyślnie): brak zakładek
    await settingsService.update({ layout: { ...snapLayout, portalNav: 'none' } });
    let html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.ok(!/role="tablist"/.test(html), '/c bez nawigacji przy none');
    assert.match(html, /Do zapłaty/); // sekcje w stosie

    // tabs: pasek zakładek na /c i /p
    await settingsService.update({ layout: { ...snapLayout, portalNav: 'tabs' } });
    html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.match(html, /role="tablist"/, '/c z zakładkami');
    assert.match(html, /sec==='platnosci'/, 'sekcja płatności sterowana x-show');
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /role="tablist"/, '/p z zakładkami');
    assert.match(html, /sec==='wyslij'/, 'sekcja wysyłki sterowana x-show');

    // side-left: kolumna menu (md+) + zakładki jako fallback mobilny
    await settingsService.update({ layout: { ...snapLayout, portalNav: 'side-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /w-44 shrink-0/, '/p z kolumną menu');
    assert.match(html, /md:hidden [^"]*flex gap-1/, 'zakładki mobilne przy menu bocznym');
    assert.match(html, /max-w-4xl/, 'szersza karta przy menu bocznym');

    // degradacja: wąska kompozycja (panel) wymusza zakładki zamiast menu bocznego
    await settingsService.update({ layout: { ...snapLayout, style: 'panel', portalNav: 'side-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.ok(!/w-44 shrink-0/.test(html), 'panel: bez kolumny menu');
    assert.match(html, /role="tablist"/, 'panel: zakładki zamiast menu');

    // walidacja: nieznana wartość wraca do none
    await settingsService.update({ layout: { ...snapLayout, portalNav: 'zmyslony' } });
    assert.equal((await settingsService.get()).layout.portalNav, 'none');
  } finally {
    await settingsService.update({ layout: snapLayout });
    if (client) await prisma.event.deleteMany({ where: { OR: [{ clientId: client.id }, { projectId: project ? project.id : -1 }] } });
    if (charge) await prisma.charge.delete({ where: { id: charge.id } }).catch(() => {});
    if (project) await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    if (client) await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  }
});
