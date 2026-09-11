// Logo w mailach — załącznik inline (`cid:`), NIE data URI.
//
// POWÓD ISTNIENIA TEGO TESTU (regresja v0.99.25 → v1.3.4): logo było osadzane jako data URI,
// a Gmail, Outlook i Yahoo takie obrazki WYCINAJĄ — u klientów nie było logo w ogóle, choć
// na Macu/iPhonie (Apple Mail renderuje data URI) wyglądało poprawnie. Test pilnuje obu stron:
// treść odwołuje się do `cid:`, a wysyłka realnie niesie załącznik.
//
// Stubuje transporter (przechwytuje wysyłkę) i settingsService.get (wstrzykuje logo).
// Nic nie wysyła realnie i nie dotyka DB zapisami.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
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
let LOGO = null;
settingsService.get = async () => { const s = await realGet(); s.emails = { ...s.emails, theme: 'classic', logoPath: LOGO }; s.logoPath = null; return s; };

const mail = require('../src/services/mail.service');

// Prawdziwy (najmniejszy możliwy) PNG — plik musi istnieć na dysku, bo załącznik bierze ścieżkę.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DIR = path.join(__dirname, '..', 'public', 'branding');
const made = [];
function put(name, buf) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  fs.writeFileSync(file, buf);
  made.push(file);
  return '/branding/' + name;
}

let PNG, SVG, BIG;
before(() => {
  const st = Date.now();
  PNG = put(`test-logo-${st}.png`, PNG_1PX);
  SVG = put(`test-logo-${st}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  BIG = put(`test-logo-big-${st}.png`, Buffer.alloc(2 * 1024 * 1024 + 1));
});
after(() => {
  made.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
  nodemailer.createTransport = realCreate;
  settingsService.get = realGet;
  if (origHost === undefined) delete config.mail.host; else config.mail.host = origHost;
});

async function sendOne(logoPath) {
  LOGO = logoPath;
  captured.length = 0;
  await mail.sendOfferLink({ to: 'k@test', url: 'https://example.test/o/tok', offer: { title: 'Test', validUntil: new Date(Date.now() + 864e5) }, client: { name: 'Klient' }, total: 12300 });
  return captured[0];
}
const logoAttachment = (m) => (m.attachments || []).find((a) => a.cid === 'evoke-logo');

test('logo rastrowe: treść odwołuje się do cid, a mail niesie załącznik inline', async () => {
  const m = await sendOne(PNG);
  assert.match(m.html, /<img src="cid:evoke-logo"/, 'obrazek wskazuje na załącznik');

  const att = logoAttachment(m);
  assert.ok(att, 'załącznik z logo dołączony do wysyłki');
  assert.equal(att.contentType, 'image/png');
  assert.equal(att.contentDisposition, 'inline', 'inline — nie jako zwykły plik do pobrania');
  assert.ok(fs.existsSync(att.path), 'załącznik wskazuje istniejący plik');
});

test('NIE data URI i NIE zdalny URL — to właśnie psuło logo w Gmailu i Outlooku', async () => {
  const m = await sendOne(PNG);
  assert.doesNotMatch(m.html, /data:image/, 'żadnego data URI (Gmail/Outlook je wycinają)');
  assert.doesNotMatch(m.html, /<img[^>]+src="https?:/, 'żadnego pobierania obrazka z sieci');
});

test('SVG: brak obrazka, zostaje wordmark tekstowy (klienty pocztowe nie renderują SVG)', async () => {
  const m = await sendOne(SVG);
  assert.doesNotMatch(m.html, /<img/, 'SVG nie trafia do maila jako obrazek');
  assert.equal(logoAttachment(m), undefined, 'nie doklejamy załącznika, którego nikt nie wyświetli');
  assert.match(m.html, /font-weight:700/, 'w zamian wordmark tekstowy');
});

test('brak pliku na dysku albo logo za duże → wordmark, bez pustego obrazka', async () => {
  const missing = await sendOne('/branding/nie-ma-takiego-pliku.png');
  assert.doesNotMatch(missing.html, /<img/, 'brak pliku = brak obrazka (zamiast ikony „nie wczytano")');
  assert.equal(logoAttachment(missing), undefined);

  const big = await sendOne(BIG);
  assert.doesNotMatch(big.html, /<img/, 'ponad 2 MB = nie pogrubiamy każdego maila');
  assert.equal(logoAttachment(big), undefined);
});

test('logo nie wypiera innych załączników (np. PDF-a z rozliczeniem)', async () => {
  LOGO = PNG;
  captured.length = 0;
  await mail.sendClientStatement({ to: 'k@test', client: { name: 'Klient' }, pdfBuffer: Buffer.from('%PDF-1.4 test'), filename: 'rozliczenie.pdf', title: 'Rozliczenie' });
  const m = captured[0];
  const names = (m.attachments || []).map((a) => a.filename);
  assert.ok(names.some((n) => n === 'rozliczenie.pdf'), 'PDF zachowany: ' + names.join(', '));
  assert.ok(logoAttachment(m), 'logo dołożone obok PDF-a');
});
