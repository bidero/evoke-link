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
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'none' } });
    let html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.ok(!/role="tablist"/.test(html), '/c bez nawigacji przy none');
    assert.match(html, /Do zapłaty/); // sekcje w stosie

    // tabs: pasek zakładek na /c i /p
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'tabs' } });
    html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.match(html, /role="tablist"/, '/c z zakładkami');
    assert.match(html, /sec==='platnosci'/, 'sekcja płatności sterowana x-show');
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /role="tablist"/, '/p z zakładkami');
    assert.match(html, /sec==='wyslij'/, 'sekcja wysyłki sterowana x-show');

    // side-left: kolumna menu (md+) + zakładki jako fallback mobilny
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'side-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /w-44 shrink-0/, '/p z kolumną menu');
    assert.match(html, /md:hidden [^"]*flex gap-1/, 'zakładki mobilne przy menu bocznym');
    assert.match(html, /max-w-4xl/, 'szersza karta przy menu bocznym');

    // degradacja: wąska kompozycja (panel) wymusza zakładki zamiast menu bocznego
    await settingsService.update({ layout: { ...snapLayout, style: 'panel', portalNav: 'side-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.ok(!/w-44 shrink-0/.test(html), 'panel: bez kolumny menu');
    assert.match(html, /role="tablist"/, 'panel: zakładki zamiast menu');

    // top: pasek u góry strony (nad kartą, poza nią)
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'top' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /data-pnav="top"/, '/p z paskiem u góry strony');
    assert.ok(!/w-44 shrink-0/.test(html), 'top: bez menu w karcie');
    html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.match(html, /data-pnav="top"/, '/c z paskiem u góry strony');

    // bar-left: pasek boczny strony + fallback mobilny (pasek u góry z md:hidden)
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'bar-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /data-pnav="bar"/, '/p z paskiem bocznym strony');
    assert.match(html, /md:hidden mb-5/, 'fallback mobilny (pasek u góry) przy pasku bocznym');
    assert.match(html, /max-w-4xl/, 'szeroki układ przy pasku bocznym');

    // degradacja: wąska kompozycja (panel) wymusza pasek u góry zamiast bocznego
    await settingsService.update({ layout: { ...snapLayout, style: 'panel', portalNav: 'bar-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.ok(!/data-pnav="bar"/.test(html), 'panel: bez paska bocznego strony');
    assert.match(html, /data-pnav="top"/, 'panel: pasek u góry zamiast bocznego');

    // header: menu w nagłówku strony (chrome layoutu, obok logo)
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'header' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /data-pnav="chrome-top"/, '/p z menu w nagłówku');
    html = await (await fetch(`${base}/c/${client.token}`)).text();
    assert.match(html, /data-pnav="chrome-top"/, '/c z menu w nagłówku');

    // rail-left: własny pełnowysoki brandowy pas z menu + fallback mobilny (pasek u góry)
    await settingsService.update({ layout: { ...snapLayout, style: 'classic', portalNav: 'rail-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /data-pnav="rail"/, '/p z pasem pionowym');
    assert.match(html, /w-60 shrink-0 bg-brand-600/, 'własny brandowy pas');
    assert.match(html, /data-pnav="top"/, 'fallback mobilny przy pasie');

    // rail przy kompozycji „Pasek boczny": menu wchodzi w istniejący pas (bez własnego)
    await settingsService.update({ layout: { ...snapLayout, style: 'sidebar', portalNav: 'rail-left' } });
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.match(html, /data-pnav="rail"/, 'sidebar: menu w pasie kompozycji');
    assert.ok(!/w-60 shrink-0 bg-brand-600/.test(html), 'sidebar: bez dublowania pasa');

    // walidacja: nieznana wartość wraca do none
    await settingsService.update({ layout: { ...snapLayout, portalNav: 'zmyslony' } });
    assert.equal((await settingsService.get()).layout.portalNav, 'none');

    // link powrotny „Wszystkie projekty" na /p: TYLKO dla sesji, która odwiedziła portal /c
    // (obcym z samym linkiem /p nie ujawniamy adresu portalu klienta z rozliczeniami)
    html = await (await fetch(`${base}/p/${project.clientToken}`)).text();
    assert.ok(!/Wszystkie projekty/.test(html), 'bez sesji z /c brak linku powrotnego');
    const rc = await fetch(`${base}/c/${client.token}`);
    const cookie = (rc.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
    html = await (await fetch(`${base}/p/${project.clientToken}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Wszystkie projekty/, 'po wizycie na /c link powrotny widoczny');
    assert.match(html, new RegExp(`href="/c/${client.token}"`), 'link prowadzi do portalu klienta');
  } finally {
    await settingsService.update({ layout: snapLayout });
    if (client) await prisma.event.deleteMany({ where: { OR: [{ clientId: client.id }, { projectId: project ? project.id : -1 }] } });
    if (charge) await prisma.charge.delete({ where: { id: charge.id } }).catch(() => {});
    if (project) await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    if (client) await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  }
});
