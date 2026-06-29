// Wysyłka e-maili przez SMTP (Nodemailer). Dane SMTP pochodzą z .env.
// Jeśli SMTP nie jest skonfigurowany (pusty SMTP_HOST), zamiast wysyłać
// wypisujemy treść w konsoli — dzięki temu aplikacja działa lokalnie bez poczty.
const nodemailer = require('nodemailer');
const config = require('../config');
const settingsService = require('./settings.service');
const { stripTags } = require('../utils/htmlEmail');

let transporter = null;
function getTransporter() {
  if (!config.mail.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transporter;
}

function isConfigured() {
  return !!config.mail.host;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Imię do powitania: firstName, a gdy puste → pełna (wyświetlana) nazwa klienta.
const greetName = (client) => (client && (client.firstName || client.name)) || '';
// Zmienne klienta do placeholderów: {klient} (pełna nazwa), {imie}, {nazwisko}.
const clientVars = (client) => ({ klient: (client && client.name) || '', imie: (client && client.firstName) || '', nazwisko: (client && client.lastName) || '' });

// Lista wspieranych placeholderów (do podpowiedzi w panelu).
const PLACEHOLDERS = ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{tytul}', '{link}', '{liczba-plikow}', '{pliki}', '{nadawca}', '{email-nadawcy}', '{wygasa}', '{przycisk}'];

// Komplet zmiennych (puste = brak danych w danym mailu); nadpisywane per e-mail.
function baseVars(appName) {
  return { 'nazwa-aplikacji': appName || 'Evoke LINK', 'nazwa-projektu': '', klient: '', imie: '', nazwisko: '', tytul: '', link: '', 'liczba-plikow': '', pliki: '', nadawca: '', 'email-nadawcy': '', wygasa: '' };
}

// Podstawia {token} znanymi wartościami (nieznane tokeny zostawia — sygnalizuje literówkę).
function fillTpl(tpl, vars) {
  if (!tpl) return '';
  return String(tpl).replace(/\{([a-z0-9-]+)\}/gi, (m, k) => (k in vars ? String(vars[k] == null ? '' : vars[k]) : m));
}

// Sprząta temat po podstawieniu pustych placeholderów (zwisające myślniki/spacje).
function cleanSubject(s) {
  return (s || '').replace(/\{przycisk\}/gi, '').replace(/\s+/g, ' ').replace(/^\s*[–—-]\s*/, '').replace(/\s*[–—-]\s*$/, '').trim();
}

async function send({ to, subject, html, text, replyTo, attachments }) {
  const t = getTransporter();
  if (!t) {
    console.log('\n[mail:DEV] (SMTP niewłączony) =>', { to, subject, attachments: attachments ? attachments.map((a) => a.filename) : undefined });
    console.log('[mail:DEV] treść:\n' + (text || html) + '\n');
    return { dev: true };
  }
  return t.sendMail({ from: config.mail.from, to, subject, html, text, replyTo, attachments });
}

// Brandowany szablon HTML maila (logo/kolor/nazwa z ustawień). content = HTML wnętrza.
async function wrap(content, { heading } = {}) {
  let s;
  try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = esc(s.appName || 'Evoke LINK');
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const mailLogo = (s.emails && s.emails.logoPath) || s.logoPath; // osobne logo maili (gdy ustawione)
  const logo = mailLogo ? `${config.appUrl}${mailLogo}` : null;
  const footer = esc((s.texts && s.texts.footer) || `${appName} · bezpieczna wymiana plików`);
  const head = logo
    ? `<img src="${esc(logo)}" alt="${appName}" style="height:34px;max-width:200px;object-fit:contain" />`
    : `<span style="font-size:18px;font-weight:700;color:#fff">${appName}</span>`;

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${esc(primary)};padding:18px 24px">${head}</td></tr>
        <tr><td style="padding:28px 24px">
          ${heading ? `<h1 style="margin:0 0 12px;font-size:20px">${esc(heading)}</h1>` : ''}
          ${content}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">${footer}</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

function btn(href, label, primary) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${esc(primary || '#6e00a5')};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(label)}</a>`;
}

// Treść (wstęp/body) → bezpieczny HTML: podstawia placeholdery; jeśli to już HTML
// (z edytora WYSIWYG, sanityzowany przy zapisie) zostawia, a tekst (wiadomość ad-hoc /
// stare treści / domyślne) escapuje i zamienia nowe linie na <br>.
function contentToHtml(value, vars) {
  const filled = fillTpl(value || '', vars);
  if (/<[a-z][\s\S]*>/i.test(filled)) return filled;
  return esc(filled).replace(/\r?\n/g, '<br>');
}

// Akapit wstępu jako HTML; {przycisk} zamieniany na przycisk CTA w danym miejscu.
function introBlock(value, vars, buttonHtml) {
  const html = contentToHtml(value, vars);
  if (/\{przycisk\}/i.test(html)) {
    return { html: `<div style="margin:0 0 18px">${html.split(/\{przycisk\}/i).join(buttonHtml)}</div>`, hasButton: true };
  }
  return { html: `<div style="margin:0 0 16px">${html}</div>`, hasButton: false };
}

// Powiadomienie do agencji o nowych plikach od klienta.
async function sendUploadNotification({ transfer, fileNames, uploaderName, uploaderEmail, projectName, client }) {
  const adminUrl = `${config.appUrl}/admin/transfers/${transfer.id}`;
  const title = transfer.title || `Upload ${transfer.token}`;
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';

  const text = [
    `Nowe pliki w: ${title}`,
    projectName ? `Projekt: ${projectName}` : null,
    uploaderName ? `Od: ${uploaderName}` : null,
    uploaderEmail ? `E-mail: ${uploaderEmail}` : null,
    '', `Pliki (${fileNames.length}):`, ...fileNames.map((n) => ` • ${n}`),
    '', `Zobacz w panelu: ${adminUrl}`,
  ].filter((l) => l !== null).join('\n');

  const inner = `
    ${projectName ? `<p style="margin:2px 0">Projekt: <b>${esc(projectName)}</b></p>` : ''}
    ${uploaderName ? `<p style="margin:2px 0">Od: <b>${esc(uploaderName)}</b></p>` : ''}
    ${uploaderEmail ? `<p style="margin:2px 0">E-mail: ${esc(uploaderEmail)}</p>` : ''}
    <p style="margin:12px 0 6px">Pliki (${fileNames.length}):</p>
    <ul style="margin:0 0 18px;padding-left:18px">${fileNames.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    ${btn(adminUrl, 'Zobacz w panelu', primary)}`;

  const html = await wrap(inner, { heading: `Nowe pliki: ${title}` });
  const vars = { ...baseVars(s.appName), ...clientVars(client), 'nazwa-projektu': projectName || '', tytul: title, 'liczba-plikow': fileNames.length, pliki: fileNames.join(', '), nadawca: uploaderName || '', 'email-nadawcy': uploaderEmail || '', link: adminUrl };
  const subject = cleanSubject(fillTpl(s.emails && s.emails.uploadSubject, vars)) || `${s.appName || 'Evoke LINK'} — nowe pliki: ${title}`;
  return send({ to: config.admin.email, subject, html, text });
}

// Wysyłka linku do transferu/uploadu na adres klienta (z panelu).
async function sendTransferLink({ to, transfer, message }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const appName = s.appName || 'Evoke LINK';
  const em = s.emails || {};
  const incoming = transfer.direction === 'incoming';
  const link = `${config.appUrl}/${incoming ? 'upload' : 't'}/${transfer.token}`;
  const title = transfer.title || (incoming ? 'Prześlij pliki' : 'Pliki dla Ciebie');
  const cta = incoming ? 'Prześlij pliki' : 'Pobierz pliki';
  const expiresStr = transfer.expiresAt ? new Date(transfer.expiresAt).toLocaleString('pl-PL') : '';
  const vars = {
    ...baseVars(appName),
    ...clientVars(transfer.project && transfer.project.client),
    'nazwa-projektu': (transfer.project && transfer.project.name) || '',
    tytul: title, link, wygasa: expiresStr,
  };
  // Treść wstępu: wiadomość z formularza > szablon z ustawień (placeholdery) > wbudowany.
  const introSrc = message || em.linkIntro || (incoming ? 'Pod tym linkiem prześlesz nam pliki:' : 'Pod tym linkiem pobierzesz przygotowane dla Ciebie pliki:');

  const ib = introBlock(introSrc, vars, btn(link, cta, primary));
  const inner = `
    ${ib.html}
    ${ib.hasButton ? '' : `<p style="margin:0 0 20px">${btn(link, cta, primary)}</p>`}
    <p style="margin:0;color:#64748b;font-size:13px">Lub skopiuj adres:<br><a href="${esc(link)}" style="color:${esc(primary)}">${esc(link)}</a></p>
    ${expiresStr ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Link wygasa: ${expiresStr}</p>` : ''}`;

  const html = await wrap(inner, { heading: title });
  const text = `${stripTags(ib.html)}\n\n${cta}: ${link}`;
  return send({ to, subject: cleanSubject(fillTpl(em.linkSubject, vars)) || `${appName} — ${title}`, html, text, replyTo: config.admin.email });
}

// Powiadomienie do agencji o pierwszym pobraniu transferu przez klienta.
async function sendDownloadNotification({ transfer, ip }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const appName = s.appName || 'Evoke LINK';
  const title = transfer.title || `Transfer ${transfer.token}`;
  const adminUrl = `${config.appUrl}/admin/transfers/${transfer.id}`;
  const inner = `
    <p style="margin:0 0 14px">Klient właśnie pobrał pliki z transferu: <b>${esc(title)}</b>.</p>
    ${ip ? `<p style="margin:0 0 14px;color:#64748b;font-size:13px">IP: ${esc(ip)}</p>` : ''}
    ${btn(adminUrl, 'Zobacz w panelu', primary)}`;
  const html = await wrap(inner, { heading: 'Pobrano pliki' });
  const text = `Klient pobrał: ${title}\n${adminUrl}`;
  const vars = { ...baseVars(appName), 'nazwa-projektu': (transfer.project && transfer.project.name) || '', tytul: title, link: adminUrl };
  const subject = cleanSubject(fillTpl(s.emails && s.emails.downloadSubject, vars)) || `${appName} — pobrano: ${title}`;
  return send({ to: config.admin.email, subject, html, text });
}

// Wysyłka linku do panelu (projektu /p/:token lub klienta /c/:token) na adres e-mail.
async function sendPanelLink({ to, url, projectName, clientName, client }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const appName = s.appName || 'Evoke LINK';
  const em = s.emails || {};
  const vars = { ...baseVars(appName), ...clientVars(client), 'nazwa-projektu': projectName || '', klient: (client && client.name) || clientName || '', link: url };

  const defSubject = projectName ? `${appName} — projekt ${projectName}` : `${appName} — Twoje projekty`;
  const defIntro = projectName
    ? `Panel projektu „${projectName}" — Twoje pliki i upload w jednym miejscu.`
    : 'Twój panel — wszystkie projekty w jednym miejscu.';
  const subject = cleanSubject(fillTpl(em.panelSubject, vars)) || defSubject;
  const introSrc = em.panelIntro || defIntro;
  const heading = projectName || clientName || 'Twój panel';

  const ib = introBlock(introSrc, vars, btn(url, 'Otwórz panel', primary));
  const inner = `
    ${ib.html}
    ${ib.hasButton ? '' : `<p style="margin:0 0 20px">${btn(url, 'Otwórz panel', primary)}</p>`}
    <p style="margin:0;color:#64748b;font-size:13px">Lub skopiuj adres:<br><a href="${esc(url)}" style="color:${esc(primary)}">${esc(url)}</a></p>`;
  const html = await wrap(inner, { heading });
  return send({ to, subject, html, text: `${stripTags(ib.html)}\n\nOtwórz panel: ${url}`, replyTo: config.admin.email });
}

// Potwierdzenie do KLIENTA po przesłaniu plików (jeśli włączone i klient podał e-mail).
async function sendUploadConfirmation({ to, transfer, projectName }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const em = s.emails || {};
  if (!em.clientConfirm) return { skipped: true };
  const appName = s.appName || 'Evoke LINK';
  const vars = { ...baseVars(appName), 'nazwa-projektu': projectName || '', tytul: (transfer && transfer.title) || '' };
  const bodyHtml = contentToHtml(em.clientConfirmBody || 'Dziękujemy! Otrzymaliśmy Twoje pliki.', vars).replace(/\{przycisk\}/gi, '');
  const inner = `
    <div style="margin:0 0 12px">${bodyHtml}</div>
    ${projectName ? `<p style="margin:0;color:#64748b;font-size:13px">Projekt: ${esc(projectName)}</p>` : ''}`;
  const html = await wrap(inner, { heading: 'Potwierdzenie' });
  return send({ to, subject: cleanSubject(fillTpl(em.clientConfirmSubject, vars)) || `${appName} — potwierdzenie odbioru plików`, html, text: stripTags(bodyHtml), replyTo: config.admin.email });
}

// Wysyłka rozliczenia/proformy do klienta z PDF w załączniku.
async function sendClientStatement({ to, client, pdfBuffer, filename, title }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const docWord = title || 'Rozliczenie';
  const intro = `W załączniku przesyłamy ${docWord.toLowerCase()} (PDF).`;
  const inner = `
    <p style="margin:0 0 10px">Dzień dobry${greetName(client) ? ' ' + esc(greetName(client)) : ''},</p>
    <p style="margin:0 0 6px">${esc(intro)}</p>`;
  const html = await wrap(inner, { heading: docWord });
  const text = `Dzień dobry${greetName(client) ? ' ' + greetName(client) : ''},\n\n${intro}\n\n${appName}`;
  return send({
    to,
    subject: `${docWord} — ${appName}`,
    html,
    text,
    replyTo: config.admin.email,
    attachments: [{ filename: filename || 'rozliczenie.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

// Przypomnienie o płatności — lista przeterminowanych pozycji + suma (cron reminders.job).
async function sendPaymentReminder({ to, client, charges, total }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const em = s.emails || {};
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const bank = (s.pdf && s.pdf.seller && s.pdf.seller.bank) || '';
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const date = (d) => new Date(d).toLocaleDateString('pl-PL');
  const intro = em.reminderIntro || 'Przypominamy o nierozliczonych pozycjach po terminie płatności:';
  const rows = charges.map((c) =>
    `<tr><td style="padding:6px 0;border-top:1px solid #e2e8f0">${esc(c.label || 'Pozycja')}</td>` +
    `<td style="padding:6px 0;border-top:1px solid #e2e8f0;color:#64748b">termin ${esc(date(c.dueDate))}</td>` +
    `<td style="padding:6px 0;border-top:1px solid #e2e8f0;text-align:right">${esc(money(c.amount))}</td></tr>`
  ).join('');
  const inner = `
    <p style="margin:0 0 10px">Dzień dobry${greetName(client) ? ' ' + esc(greetName(client)) : ''},</p>
    <p style="margin:0 0 12px">${esc(intro)}</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="margin:14px 0 0;text-align:right;font-size:16px"><b>Razem do zapłaty: <span style="color:${esc(primary)}">${esc(money(total))}</span></b></p>
    ${bank ? `<p style="margin:14px 0 0;color:#64748b;font-size:13px">Numer konta: ${esc(bank)}</p>` : ''}`;
  const html = await wrap(inner, { heading: 'Przypomnienie o płatności' });
  const text = `Dzień dobry${greetName(client) ? ' ' + greetName(client) : ''},\n\n${intro}\n` +
    charges.map((c) => ` • ${c.label || 'Pozycja'} (termin ${date(c.dueDate)}): ${money(c.amount)}`).join('\n') +
    `\n\nRazem do zapłaty: ${money(total)}` + (bank ? `\nNumer konta: ${bank}` : '');
  const subject = (em.reminderSubject || '').trim() || `${appName} — przypomnienie o płatności`;
  return send({ to, subject, html, text, replyTo: config.admin.email });
}

// Testowy e-mail do weryfikacji konfiguracji SMTP.
async function sendTest({ to }) {
  const inner = `<p style="margin:0 0 8px">To jest testowa wiadomość z Twojej instancji.</p>
    <p style="margin:0;color:#64748b;font-size:13px">Jeśli ją widzisz — wysyłka e-mail działa poprawnie. 🎉</p>`;
  const html = await wrap(inner, { heading: 'Test e-mail' });
  return send({ to, subject: 'Test e-mail — działa', html, text: 'Test e-mail — jeśli to widzisz, wysyłka działa.' });
}

module.exports = { send, isConfigured, PLACEHOLDERS, sendUploadNotification, sendTransferLink, sendPanelLink, sendDownloadNotification, sendUploadConfirmation, sendClientStatement, sendPaymentReminder, sendTest };
