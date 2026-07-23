// Motyw maili (emails.theme) — WSZYSTKIE maile renderują wybrany szablon.
// Stubuje transporter (przechwytuje HTML) i settingsService.get (wstrzykuje motyw).
// Nie wysyła nic realnie, nie dotyka DB zapisami.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const nodemailer = require('nodemailer');
const captured = [];
const realCreate = nodemailer.createTransport;
nodemailer.createTransport = () => ({ sendMail: async (o) => { captured.push(o); return { ok: true }; } });

const config = require('../src/config');
const origHost = config.mail && config.mail.host;
config.mail = config.mail || {};
config.mail.host = 'test'; config.mail.from = 'noreply@test';
config.admin = config.admin || {}; config.admin.email = 'admin@test';
config.appUrl = config.appUrl || 'https://example.test';

const settingsService = require('../src/services/settings.service');
const realGet = settingsService.get.bind(settingsService);
let THEME = 'classic';
settingsService.get = async () => { const s = await realGet(); s.emails = { ...s.emails, theme: THEME, logoPath: null }; return s; };

const mail = require('../src/services/mail.service');

after(() => { nodemailer.createTransport = realCreate; settingsService.get = realGet; if (origHost === undefined) delete config.mail.host; else config.mail.host = origHost; });

async function renderOffer(theme) {
  THEME = theme;
  captured.length = 0;
  await mail.sendOfferLink({ to: 'k@test', url: 'https://example.test/o/tok', offer: { title: 'Test', validUntil: new Date(Date.now() + 864e5) }, client: { name: 'Klient' }, total: 12300 });
  return captured[0].html;
}

test('każdy motyw renderuje poprawny, rozróżnialny szablon', async () => {
  const classic = await renderOffer('classic');
  const minimal = await renderOffer('minimal');
  const rail = await renderOffer('rail');
  const tint = await renderOffer('tint');
  const badge = await renderOffer('badge');

  // Wspólne: treść oferty i przycisk zawsze obecne (opakowanie nie gubi contentu).
  for (const html of [classic, minimal, rail, tint, badge]) {
    assert.match(html, /Redesign|Test/); // tytuł oferty w treści
    assert.match(html, /Zobacz i zatwierd/); // przycisk CTA
    assert.match(html, /color-scheme/); // meta light
  }
  // Klasyczny ma pasek 4px u góry; minimal go NIE ma i nie ma karty z cieniem.
  assert.match(classic, /height:4px/);
  assert.doesNotMatch(minimal, /height:4px/);
  assert.doesNotMatch(minimal, /box-shadow/);
  // Rail ma pionową komórkę-pasek (width="6").
  assert.match(rail, /width="6"/);
  // Badge ma wyśrodkowany nagłówek.
  assert.match(badge, /text-align:center/);
  // Motywy różnią się między sobą (nie ten sam HTML).
  const set = new Set([classic, minimal, rail, tint, badge]);
  assert.strictEqual(set.size, 5);
});

test('nieznany motyw → fallback classic', async () => {
  const bad = await renderOffer('nieistnieje');
  assert.match(bad, /height:4px/); // classic marker
});
