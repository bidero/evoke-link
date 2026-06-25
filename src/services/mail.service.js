// Wysyłka e-maili przez SMTP (Nodemailer).
// Jeśli SMTP nie jest skonfigurowany (pusty SMTP_HOST), zamiast wysyłać
// wypisujemy treść w konsoli — dzięki temu aplikacja działa lokalnie bez poczty.
const nodemailer = require('nodemailer');
const config = require('../config');

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

async function send({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log('\n[mail:DEV] (SMTP niewłączony) =>', { to, subject });
    console.log('[mail:DEV] treść:\n' + (text || html) + '\n');
    return { dev: true };
  }
  return t.sendMail({ from: config.mail.from, to, subject, html, text });
}

// Powiadomienie do agencji o nowych plikach od klienta.
async function sendUploadNotification({ transfer, fileNames, uploaderName, uploaderEmail }) {
  const adminUrl = `${config.appUrl}/admin/transfers/${transfer.id}`;
  const title = transfer.title || `Upload ${transfer.token}`;
  const lines = [
    `Nowe pliki w: ${title}`,
    uploaderName ? `Od: ${uploaderName}` : null,
    uploaderEmail ? `E-mail: ${uploaderEmail}` : null,
    '',
    `Pliki (${fileNames.length}):`,
    ...fileNames.map((n) => ` • ${n}`),
    '',
    `Zobacz w panelu: ${adminUrl}`,
  ].filter((l) => l !== null);

  const html = `
    <h2 style="margin:0 0 8px">Nowe pliki: ${title}</h2>
    ${uploaderName ? `<p style="margin:2px 0">Od: <b>${uploaderName}</b></p>` : ''}
    ${uploaderEmail ? `<p style="margin:2px 0">E-mail: ${uploaderEmail}</p>` : ''}
    <p style="margin:12px 0 4px">Pliki (${fileNames.length}):</p>
    <ul>${fileNames.map((n) => `<li>${n}</li>`).join('')}</ul>
    <p style="margin-top:16px"><a href="${adminUrl}">Zobacz w panelu →</a></p>`;

  return send({ to: config.admin.email, subject: `Evoke LINK — nowe pliki: ${title}`, html, text: lines.join('\n') });
}

module.exports = { send, sendUploadNotification };
