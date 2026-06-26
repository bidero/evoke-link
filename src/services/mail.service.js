// Wysyłka e-maili przez SMTP (Nodemailer). Dane SMTP pochodzą z .env.
// Jeśli SMTP nie jest skonfigurowany (pusty SMTP_HOST), zamiast wysyłać
// wypisujemy treść w konsoli — dzięki temu aplikacja działa lokalnie bez poczty.
const nodemailer = require('nodemailer');
const config = require('../config');
const settingsService = require('./settings.service');

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

async function send({ to, subject, html, text, replyTo }) {
  const t = getTransporter();
  if (!t) {
    console.log('\n[mail:DEV] (SMTP niewłączony) =>', { to, subject });
    console.log('[mail:DEV] treść:\n' + (text || html) + '\n');
    return { dev: true };
  }
  return t.sendMail({ from: config.mail.from, to, subject, html, text, replyTo });
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

// Powiadomienie do agencji o nowych plikach od klienta.
async function sendUploadNotification({ transfer, fileNames, uploaderName, uploaderEmail, projectName }) {
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
  const subject = (s.emails && s.emails.uploadSubject) || `${s.appName || 'Evoke LINK'} — nowe pliki: ${title}`;
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
  // Treść wstępu: wiadomość z formularza > domyślny wstęp z ustawień > wbudowany.
  const intro = message || em.linkIntro || (incoming ? 'Pod tym linkiem prześlesz nam pliki:' : 'Pod tym linkiem pobierzesz przygotowane dla Ciebie pliki:');

  const inner = `
    <p style="margin:0 0 16px;white-space:pre-line">${esc(intro)}</p>
    <p style="margin:0 0 20px">${btn(link, cta, primary)}</p>
    <p style="margin:0;color:#64748b;font-size:13px">Lub skopiuj adres:<br><a href="${esc(link)}" style="color:${esc(primary)}">${esc(link)}</a></p>
    ${transfer.expiresAt ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Link wygasa: ${new Date(transfer.expiresAt).toLocaleString('pl-PL')}</p>` : ''}`;

  const html = await wrap(inner, { heading: title });
  const text = `${intro}\n\n${cta}: ${link}`;
  return send({ to, subject: em.linkSubject || `${appName} — ${title}`, html, text, replyTo: config.admin.email });
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
  const subject = (s.emails && s.emails.downloadSubject) || `${appName} — pobrano: ${title}`;
  return send({ to: config.admin.email, subject, html, text });
}

// Potwierdzenie do KLIENTA po przesłaniu plików (jeśli włączone i klient podał e-mail).
async function sendUploadConfirmation({ to, transfer, projectName }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const em = s.emails || {};
  if (!em.clientConfirm) return { skipped: true };
  const appName = s.appName || 'Evoke LINK';
  const body = em.clientConfirmBody || 'Dziękujemy! Otrzymaliśmy Twoje pliki.';
  const inner = `
    <p style="margin:0 0 12px;white-space:pre-line">${esc(body)}</p>
    ${projectName ? `<p style="margin:0;color:#64748b;font-size:13px">Projekt: ${esc(projectName)}</p>` : ''}`;
  const html = await wrap(inner, { heading: 'Potwierdzenie' });
  return send({ to, subject: em.clientConfirmSubject || `${appName} — potwierdzenie odbioru plików`, html, text: body, replyTo: config.admin.email });
}

// Testowy e-mail do weryfikacji konfiguracji SMTP.
async function sendTest({ to }) {
  const inner = `<p style="margin:0 0 8px">To jest testowa wiadomość z Twojej instancji.</p>
    <p style="margin:0;color:#64748b;font-size:13px">Jeśli ją widzisz — wysyłka e-mail działa poprawnie. 🎉</p>`;
  const html = await wrap(inner, { heading: 'Test e-mail' });
  return send({ to, subject: 'Test e-mail — działa', html, text: 'Test e-mail — jeśli to widzisz, wysyłka działa.' });
}

module.exports = { send, isConfigured, sendUploadNotification, sendTransferLink, sendDownloadNotification, sendUploadConfirmation, sendTest };
