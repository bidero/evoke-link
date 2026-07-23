// Wysyłka e-maili przez SMTP (Nodemailer). Dane SMTP pochodzą z .env.
// Jeśli SMTP nie jest skonfigurowany (pusty SMTP_HOST), zamiast wysyłać
// wypisujemy treść w konsoli — dzięki temu aplikacja działa lokalnie bez poczty.
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settingsService = require('./settings.service');
const { grossOf } = require('./charge.service'); // kwoty BRUTTO w mailach (amount = netto)
const { stripTags } = require('../utils/htmlEmail');
const { hexToRgb } = require('../utils/color');

const MAIL_THEMES = ['classic', 'minimal', 'rail', 'tint', 'badge'];
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public'); // logo brandingu leży w public/branding/
const LOGO_MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// Logo maila OSADZONE inline (data URI), wczytane z pliku na dysku — ładuje się NATYCHMIAST z treścią
// maila, bez zdalnego pobierania (koniec „logo ładuje się wieczność") i działa też gdy appUrl to
// localhost / adres niedostępny z zewnątrz. SVG dozwolone (inline renderuje klient, który je wspiera,
// jak wcześniej). Za duże (>48 KB — ryzyko przycięcia maila w Gmailu ~102 KB) albo brak pliku → null
// (wtedy wrap() daje remote-URL dla rastra, a dla SVG/braku — czysty wordmark tekstowy).
function logoDataUri(rawLogo) {
  if (!rawLogo) return null;
  const ext = (String(rawLogo).match(/\.([a-z0-9]+)(?:\?|$)/i) || [])[1];
  const mime = ext && LOGO_MIME[ext.toLowerCase()];
  if (!mime) return null;
  try {
    const file = path.join(PUBLIC_DIR, String(rawLogo).replace(/\.\./g, '').replace(/^\/+/, ''));
    const buf = fs.readFileSync(file);
    if (buf.length > 48 * 1024) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}

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

// Które placeholdery REALNIE działają w którym polu (uczciwa podpowiedź w panelu).
// Klucz = nazwa pola formularza w Ustawieniach → E-mail. Musi zgadzać się z tym, co dana
// funkcja maila faktycznie podstawia (vars). {przycisk} tylko we wstępach (nie w temacie).
const PLACEHOLDER_SUPPORT = {
  linkSubject: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{tytul}', '{link}', '{wygasa}'],
  linkIntro: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{tytul}', '{link}', '{wygasa}', '{przycisk}'],
  uploadSubject: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{tytul}', '{link}', '{liczba-plikow}', '{pliki}', '{nadawca}', '{email-nadawcy}'],
  downloadSubject: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{tytul}', '{link}'],
  panelSubject: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{link}'],
  panelIntro: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{klient}', '{imie}', '{nazwisko}', '{link}', '{przycisk}'],
  onboardSubject: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}', '{link}'],
  onboardIntro: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}', '{link}', '{przycisk}'],
  retainerSubject: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}', '{tytul}'],
  retainerIntro: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}', '{tytul}', '{link}', '{przycisk}'],
  clientConfirmSubject: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{tytul}'],
  clientConfirmBody: ['{nazwa-aplikacji}', '{nazwa-projektu}', '{tytul}'],
  reminderSubject: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}'],
  reminderIntro: ['{nazwa-aplikacji}', '{klient}', '{imie}', '{nazwisko}'],
};

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

// Miesza kolor marki z bielą (t=0..1) i zwraca hex — do jasnych tintów w motywach.
function tintHex(primary, t) {
  const rgb = hexToRgb(primary) || [110, 0, 165];
  return '#' + rgb.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
}

// Brandowany szablon HTML maila (logo/kolor/nazwa z ustawień). content = HTML wnętrza.
// Motyw wyglądu WSZYSTKICH maili wybierany w Ustawieniach → E-mail (`emails.theme`):
//   classic — cienki brandowy pasek u góry + logo na białym (domyślny),
//   minimal — bez karty/cienia, samo światło i hairline (styl Stripe/Linear),
//   rail    — pionowy pasek marki przy lewej krawędzi karty,
//   tint    — nagłówek na delikatnym tincie marki,
//   badge   — wyśrodkowana ikona-badge + nagłówek (styl transakcyjny).
// „preheader" = ukryty podgląd w skrzynce (domyślnie = heading).
async function wrap(content, { heading, preheader } = {}) {
  let s;
  try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = esc(s.appName || 'Evoke LINK');
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const theme = MAIL_THEMES.includes(s.emails && s.emails.theme) ? s.emails.theme : 'classic';
  // Logo maila: najpierw próba OSADZENIA inline (data URI z pliku — natychmiastowe, bez fetchu).
  // Gdy się nie uda (za duże/brak): raster → remote URL (fallback), SVG/brak → wordmark tekstowy.
  const rawLogo = (s.emails && s.emails.logoPath) || s.logoPath;
  const logo = logoDataUri(rawLogo)
    || (rawLogo && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(rawLogo) ? `${config.appUrl}${rawLogo}` : null);
  const footer = esc((s.texts && s.texts.footer) || `${appName} · bezpieczna wymiana plików`);
  const wordmark = (align) => (logo
    ? `<img src="${esc(logo)}" alt="${appName}" style="height:30px;max-width:190px;object-fit:contain;display:${align === 'center' ? 'inline-block' : 'block'}" />`
    : `<span style="font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${esc(primary)}">${appName}</span>`);
  const headingH1 = (align) => (heading
    ? `<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0f172a${align === 'center' ? ';text-align:center' : ''}">${esc(heading)}</h1>`
    : '');
  const body = (align) => `<div style="font-size:15px;line-height:1.6;color:#334155${align === 'center' ? ';text-align:center' : ''}">${content}</div>`;
  const pre = (preheader || heading)
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(preheader || heading)}</div>`
    : '';
  const head = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>`;
  const openBody = `<body style="margin:0;padding:0;background:#f4f4f7;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">${pre}`;
  // Stopka: hairline (cienka linia, jak na mockupach A/B/C) albo szary pasek (motyw tint = mockup D).
  const footerBar = `<td style="padding:20px 36px;background:#fafafa;border-top:1px solid #f0f0f4;color:#94a3b8;font-size:12px;line-height:1.5">${footer}</td>`;
  const footerHair = (center) => `<td ${center ? 'align="center" ' : ''}style="padding:28px 36px 36px"><div style="border-top:1px solid #f0f0f4;padding-top:16px;color:#94a3b8;font-size:12px;line-height:1.5${center ? ';text-align:center' : ''}">${footer}</div></td>`;
  const outer = (card) => `${head}${openBody}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7"><tr><td align="center" style="padding:32px 16px">${card}</td></tr></table></body></html>`;
  const cardStyle = 'max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ececf1;box-shadow:0 1px 3px rgba(15,23,42,0.06)';

  // --- MINIMAL: bez karty, hairline, dużo światła ---
  if (theme === 'minimal') {
    return outer(`<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff">
        <tr><td style="padding:36px 40px 0">${wordmark()}</td></tr>
        <tr><td style="padding:26px 40px 0">${headingH1()}${body()}</td></tr>
        <tr><td style="padding:32px 40px 40px"><div style="border-top:1px solid #ececf1;padding-top:16px;color:#94a3b8;font-size:12px;line-height:1.5">${footer}</div></td></tr>
      </table>`);
  }

  // --- RAIL: pionowy pasek marki przy lewej krawędzi ---
  if (theme === 'rail') {
    return outer(`<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="${cardStyle}">
        <tr>
          <td width="6" style="background:${esc(primary)};font-size:0;line-height:0">&nbsp;</td>
          <td style="padding:28px 34px">
            ${wordmark()}
            <div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>
            ${headingH1()}${body()}
            <div style="margin-top:24px;border-top:1px solid #f0f0f4;padding-top:14px;color:#94a3b8;font-size:12px;line-height:1.5">${footer}</div>
          </td>
        </tr>
      </table>`);
  }

  // --- TINT: nagłówek na delikatnym tincie marki (szary pasek stopki = mockup D) ---
  if (theme === 'tint') {
    const tintBg = tintHex(primary, 0.92);
    const tintBorder = tintHex(primary, 0.82);
    return outer(`<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="${cardStyle}">
        <tr><td style="padding:24px 36px;background:${tintBg};border-bottom:1px solid ${tintBorder}">${wordmark()}</td></tr>
        <tr><td style="padding:26px 36px 32px">${headingH1()}${body()}</td></tr>
        <tr>${footerBar}</tr>
      </table>`);
  }

  // --- BADGE: wyśrodkowana ikona-badge + nagłówek I TREŚĆ (transakcyjny) ---
  if (theme === 'badge') {
    const tintBg = tintHex(primary, 0.9);
    const initial = esc((s.appName || 'E').trim().charAt(0).toUpperCase() || 'E');
    const badge = logo
      ? `<img src="${esc(logo)}" alt="${appName}" style="height:40px;max-width:180px;object-fit:contain;display:inline-block" />`
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;background:${tintBg};border-radius:16px;font-size:24px;font-weight:700;color:${esc(primary)};text-align:center">${initial}</td></tr></table>`;
    return outer(`<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="${cardStyle}">
        <tr><td align="center" style="padding:40px 40px 0">${badge}<div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>${headingH1('center')}</td></tr>
        <tr><td align="center" style="padding:4px 40px 34px">${body('center')}</td></tr>
        <tr>${footerHair(true)}</tr>
      </table>`);
  }

  // --- CLASSIC (domyślny): cienki brandowy pasek u góry + logo na białym ---
  return outer(`<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="${cardStyle}">
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${esc(primary)}">&nbsp;</td></tr>
        <tr><td style="padding:26px 36px 0">${wordmark()}</td></tr>
        <tr><td style="padding:22px 36px 32px">${headingH1()}${body()}</td></tr>
        <tr>${footerHair()}</tr>
      </table>`);
}

function btn(href, label, primary) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${esc(primary || '#6e00a5')};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1;padding:14px 26px;border-radius:12px;letter-spacing:0.01em">${esc(label)}</a>`;
}

// Wyróżniony „box z kwotą" jak na mockupach: brandowy tint, DUŻA kwota w kolorze marki + muted subline.
// Opcjonalny `caption` (mniejsza etykieta nad kwotą, np. nazwa pozycji). Centruje się sam w motywie
// badge (dziedziczy text-align z wrappera treści), lewo w pozostałych.
function amountBox(primary, amount, subline, caption) {
  const p = primary || '#6e00a5';
  return `<div style="margin:0 0 22px;padding:20px 22px;background:${tintHex(p, 0.94)};border:1px solid ${tintHex(p, 0.86)};border-radius:14px">`
    + (caption ? `<div style="margin:0 0 6px;color:#64748b;font-size:13px;font-weight:500">${esc(caption)}</div>` : '')
    + `<div style="font-size:27px;font-weight:700;letter-spacing:-0.02em;line-height:1.15;color:${p}">${esc(amount)}</div>`
    + (subline ? `<div style="margin-top:4px;color:#94a3b8;font-size:13px">${esc(subline)}</div>` : '')
    + `</div>`;
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

// Wysyłka linku onboardingowego (jednorazowy formularz uzupełnienia danych) do klienta.
async function sendOnboardingLink({ to, url, client, expiresAt }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const appName = s.appName || 'Evoke LINK';
  const em = s.emails || {};
  const vars = { ...baseVars(appName), ...clientVars(client), link: url };
  const expiresStr = expiresAt ? new Date(expiresAt).toLocaleString('pl-PL') : '';

  const subject = cleanSubject(fillTpl(em.onboardSubject, vars)) || `${appName} — prośba o uzupełnienie danych`;
  const introSrc = em.onboardIntro || 'Prosimy o uzupełnienie danych potrzebnych do współpracy i rozliczeń. Zajmie to około 2 minut.';

  const ib = introBlock(introSrc, vars, btn(url, 'Uzupełnij dane', primary));
  const inner = `
    ${ib.html}
    ${ib.hasButton ? '' : `<p style="margin:0 0 20px">${btn(url, 'Uzupełnij dane', primary)}</p>`}
    <p style="margin:0;color:#64748b;font-size:13px">Lub skopiuj adres:<br><a href="${esc(url)}" style="color:${esc(primary)}">${esc(url)}</a></p>
    ${expiresStr ? `<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Link jest ważny do: ${expiresStr}</p>` : ''}`;
  const html = await wrap(inner, { heading: 'Uzupełnij swoje dane' });
  const text = `${stripTags(ib.html)}\n\nUzupełnij dane: ${url}` + (expiresStr ? `\nLink jest ważny do: ${expiresStr}` : '');
  return send({ to, subject, html, text, replyTo: config.admin.email });
}

// Powiadomienie do agencji: klient wypełnił formularz onboardingowy.
async function sendOnboardingCompleted({ client }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const adminUrl = `${config.appUrl}/admin/clients/${client.id}`;
  const fields = [
    ['Firma', client.company],
    ['NIP', client.nip],
    ['Adres', client.address],
    ['Imię i nazwisko', [client.firstName, client.lastName].filter(Boolean).join(' ')],
    ['Telefon', client.phone],
    ['E-mail', client.email],
  ].filter(([, v]) => v);
  const inner = `
    <p style="margin:0 0 12px">Klient <b>${esc(client.name)}</b> uzupełnił swoje dane przez link onboardingowy.</p>
    <ul style="margin:0 0 18px;padding-left:18px">${fields.map(([k, v]) => `<li style="margin:2px 0"><span style="color:#64748b">${esc(k)}:</span> ${esc(v)}</li>`).join('')}</ul>
    ${btn(adminUrl, 'Zobacz kartę klienta', primary)}`;
  const html = await wrap(inner, { heading: 'Klient uzupełnił dane' });
  const text = `Klient uzupełnił dane: ${client.name}\n` + fields.map(([k, v]) => ` • ${k}: ${v}`).join('\n') + `\n\n${adminUrl}`;
  return send({ to: config.admin.email, subject: `${appName} — klient uzupełnił dane: ${client.name}`, html, text });
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
  const rvars = { ...baseVars(appName), ...clientVars(client) };
  const intro = fillTpl(em.reminderIntro, rvars) || 'Przypominamy o nierozliczonych pozycjach po terminie płatności:';
  const rows = charges.map((c) =>
    `<tr><td style="padding:6px 0;border-top:1px solid #e2e8f0">${esc(c.label || 'Pozycja')}</td>` +
    `<td style="padding:6px 0;border-top:1px solid #e2e8f0;color:#64748b">termin ${esc(date(c.dueDate))}</td>` +
    `<td style="padding:6px 0;border-top:1px solid #e2e8f0;text-align:right">${esc(money(grossOf(c)))}</td></tr>`
  ).join('');
  const inner = `
    <p style="margin:0 0 10px">Dzień dobry${greetName(client) ? ' ' + esc(greetName(client)) : ''},</p>
    <p style="margin:0 0 12px">${esc(intro)}</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="margin:14px 0 0;text-align:right;font-size:16px"><b>Razem do zapłaty: <span style="color:${esc(primary)}">${esc(money(total))}</span></b></p>
    ${bank ? `<p style="margin:14px 0 0;color:#64748b;font-size:13px">Numer konta: ${esc(bank)}</p>` : ''}`;
  const html = await wrap(inner, { heading: 'Przypomnienie o płatności' });
  const text = `Dzień dobry${greetName(client) ? ' ' + greetName(client) : ''},\n\n${intro}\n` +
    charges.map((c) => ` • ${c.label || 'Pozycja'} (termin ${date(c.dueDate)}): ${money(grossOf(c))}`).join('\n') +
    `\n\nRazem do zapłaty: ${money(total)}` + (bank ? `\nNumer konta: ${bank}` : '');
  const subject = cleanSubject(fillTpl(em.reminderSubject, rvars)) || `${appName} — przypomnienie o płatności`;
  return send({ to, subject, html, text, replyTo: config.admin.email });
}

// Mail do KLIENTA o nowej pozycji cyklicznej (retainer) — kwota, termin, dane przelewu, link do portalu.
async function sendRetainerCharge({ to, client, charge, seller, portalUrl }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const em = s.emails || {};
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const gross = grossOf(charge);
  const dueStr = charge.dueDate ? new Date(charge.dueDate).toLocaleDateString('pl-PL') : '';
  const vars = { ...baseVars(appName), ...clientVars(client), tytul: charge.label, link: portalUrl };

  const subject = cleanSubject(fillTpl(em.retainerSubject, vars)) || `${appName} — nowa pozycja rozliczeniowa: ${charge.label}`;
  const introSrc = em.retainerIntro || 'Wystawiliśmy nową pozycję rozliczeniową:';
  const bank = (seller && seller.bank) || '';
  const title = `Rozliczenie — ${(client && client.name) || ''}`.slice(0, 32);

  const ib = introBlock(introSrc, vars, btn(portalUrl, 'Zobacz szczegóły', primary));
  const inner = `
    ${ib.html}
    ${amountBox(primary, money(gross), 'do zapłaty' + (dueStr ? ` · termin ${dueStr}` : ''), charge.label)}
    ${bank ? `<p style="margin:0 0 4px;color:#64748b;font-size:13px">${seller.name ? `Odbiorca: ${esc(seller.name)}<br>` : ''}Konto: ${esc(bank)}<br>Tytuł: ${esc(title)}</p>` : ''}
    ${ib.hasButton ? '' : `<p style="margin:16px 0 0">${btn(portalUrl, 'Zobacz szczegóły', primary)}</p>`}`;
  const html = await wrap(inner, { heading: 'Nowa pozycja rozliczeniowa' });
  const text = `${stripTags(ib.html)}\n\n${charge.label}\nDo zapłaty: ${money(gross)}${dueStr ? ` (termin ${dueStr})` : ''}\n` +
    (bank ? `${seller.name ? 'Odbiorca: ' + seller.name + '\n' : ''}Konto: ${bank}\nTytuł: ${title}\n` : '') + `\nSzczegóły: ${portalUrl}`;
  return send({ to, subject, html, text, replyTo: config.admin.email });
}

// Powiadomienie do agencji: klient zgłosił wykonanie przelewu w portalu (do potwierdzenia).
async function sendPaymentDeclared({ client, total, count }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const adminUrl = `${config.appUrl}/admin/clients/${client.id}?tab=rozliczenia`;
  const inner = `
    <p style="margin:0 0 10px">Klient <b>${esc(client.name)}</b> zgłosił wykonanie przelewu za nierozliczone pozycje.</p>
    <p style="margin:0 0 14px;color:#64748b;font-size:13px">Pozycji: ${count} · razem <b style="color:${esc(primary)}">${esc(money(total))}</b></p>
    <p style="margin:0 0 14px;color:#64748b;font-size:13px">Sprawdź wpłatę na koncie i oznacz pozycje jako rozliczone.</p>
    ${btn(adminUrl, 'Zobacz rozliczenia klienta', primary)}`;
  const html = await wrap(inner, { heading: 'Klient zgłosił wpłatę' });
  const text = `Klient zgłosił wpłatę: ${client.name}\nPozycji: ${count}, razem ${money(total)}\n\n${adminUrl}`;
  return send({ to: config.admin.email, subject: `${appName} — klient zgłosił wpłatę: ${client.name}`, html, text });
}

// Powiadomienie do agencji o nowej wiadomości od klienta (z portalu /p, /t, /c).
async function sendNewMessageNotification({ message, client, project, transfer }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const adminUrl = `${config.appUrl}/admin/messages`;
  const ctx = [
    client ? `Klient: ${client.name}` : null,
    project ? `Projekt: ${project.name}` : null,
    transfer ? `Transfer: ${transfer.title || transfer.token}` : null,
    message.senderName ? `Od: ${message.senderName}` : null,
    message.senderEmail ? `E-mail: ${message.senderEmail}` : null,
    message.attachmentName ? `Załącznik: ${message.attachmentName}` : null,
  ].filter(Boolean);
  const inner = `
    ${ctx.map((l) => `<p style="margin:2px 0;color:#64748b;font-size:13px">${esc(l)}</p>`).join('')}
    <div style="margin:12px 0 18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;white-space:pre-wrap">${esc(message.body)}</div>
    ${btn(adminUrl, 'Zobacz w panelu', primary)}`;
  const html = await wrap(inner, { heading: 'Nowa wiadomość od klienta' });
  const text = `${ctx.join('\n')}\n\n${message.body}\n\nZobacz: ${adminUrl}`;
  return send({
    to: config.admin.email,
    subject: `${appName} — nowa wiadomość${message.senderName ? ' od ' + message.senderName : ''}`,
    html,
    text,
    replyTo: message.senderEmail || config.admin.email,
  });
}

// Odpowiedź agencji do klienta (Faza B) — mail z treścią + link zwrotny do panelu.
async function sendClientReply({ to, body, link }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const inner = `
    <div style="margin:0 0 16px;white-space:pre-wrap">${esc(body)}</div>
    ${link ? `<p style="margin:0 0 8px">${btn(link, 'Otwórz panel i odpisz', primary)}</p>` : ''}`;
  const html = await wrap(inner, { heading: `Odpowiedź od ${appName}` });
  const text = `${body}` + (link ? `\n\nOtwórz panel: ${link}` : '');
  return send({ to, subject: `${appName} — odpowiedź na Twoją wiadomość`, html, text, replyTo: config.admin.email });
}

// Ostrzeżenie do agencji: transfery wygasające <24h, których klient nie pobrał (cron reminders).
async function sendExpiryWarning({ transfers }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const when = (d) => new Date(d).toLocaleString('pl-PL');
  const rows = transfers.map((t) => {
    const url = `${config.appUrl}/admin/transfers/${t.id}`;
    const title = t.title || `Transfer ${t.token}`;
    return `<tr><td style="padding:6px 0;border-top:1px solid #e2e8f0"><a href="${esc(url)}" style="color:${esc(primary)}">${esc(title)}</a>${t.project ? ` <span style="color:#94a3b8">(${esc(t.project.name)})</span>` : ''}</td>` +
      `<td style="padding:6px 0;border-top:1px solid #e2e8f0;color:#64748b;text-align:right;white-space:nowrap">wygasa ${esc(when(t.expiresAt))}</td></tr>`;
  }).join('');
  const inner = `
    <p style="margin:0 0 12px">Te transfery wygasają w ciągu 24 h, a klient ich jeszcze nie pobrał:</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">${rows}</table>`;
  const html = await wrap(inner, { heading: 'Transfery wygasają wkrótce' });
  const text = transfers.map((t) => ` • ${t.title || t.token} — wygasa ${when(t.expiresAt)} — ${config.appUrl}/admin/transfers/${t.id}`).join('\n');
  return send({ to: config.admin.email, subject: `${appName} — transfery wygasają wkrótce (${transfers.length})`, html, text });
}

// Dzienne podsumowanie do agencji (zadania na dziś, nowe wiadomości, aktywność, zaległe płatności).
async function sendDailyDigest({ reminders = [], messages = [], activity = [], overdueCharges = [] }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const url = `${config.appUrl}/admin`;
  const now = new Date();
  const dt = (d) => new Date(d).toLocaleString('pl-PL');
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const li = (t) => `<div style="padding:5px 0;border-top:1px solid #f1f5f9;font-size:14px">${t}</div>`;
  const section = (title, items) => (items.length ? `<p style="margin:16px 0 4px;font-weight:600;font-size:14px">${esc(title)}</p>${items.join('')}` : '');

  const remItems = reminders.map((r) => li(`${esc(r.title)} <span style="color:#94a3b8;font-size:12px">— ${esc(dt(r.dueAt))}${new Date(r.dueAt) < now ? ' · zaległe' : ''}${r.sub ? ' · ' + esc(r.sub) : ''}</span>`));
  const msgItems = messages.map((m) => li(`<b>${esc(m.senderName || 'Klient')}</b>: ${esc(String(m.body || '').slice(0, 120))}`));
  const actItems = activity.map((e) => li(`${esc(e.message || e.type)} <span style="color:#94a3b8;font-size:12px">— ${esc(dt(e.createdAt))}</span>`));
  const chargeTotal = overdueCharges.reduce((n, c) => n + grossOf(c), 0);
  const chargeItems = overdueCharges.length ? [li(`Przeterminowane płatności: <b>${overdueCharges.length}</b> na łącznie <b style="color:${esc(primary)}">${esc(money(chargeTotal))}</b>`)] : [];

  const inner = `
    <p style="margin:0 0 6px;color:#64748b">Podsumowanie na ${esc(now.toLocaleDateString('pl-PL'))}.</p>
    ${section('Zadania na dziś / zaległe', remItems)}
    ${section('Nowe wiadomości', msgItems)}
    ${section('Aktywność (ostatnia doba)', actItems)}
    ${section('Rozliczenia', chargeItems)}
    <p style="margin:18px 0 0">${btn(url, 'Otwórz panel', primary)}</p>`;
  const html = await wrap(inner, { heading: `Twój dzień · ${appName}` });
  const text = [...remItems, ...msgItems, ...actItems, ...chargeItems].map((x) => x.replace(/<[^>]+>/g, '')).join('\n') || 'Brak nowości.';
  return send({ to: config.admin.email, subject: `${appName} — podsumowanie dnia`, html, text });
}

// Proofing: decyzja klienta (zatwierdzenie / prośba o poprawki) → mail do agencji.
async function sendProofingDecision({ transfer, decision, comment, name, projectName }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const approved = decision === 'approved';
  const title = transfer.title || `Transfer ${transfer.token}`;
  const adminUrl = `${config.appUrl}/admin/transfers/${transfer.id}`;
  const heading = approved ? 'Pliki zatwierdzone ✓' : 'Klient prosi o poprawki';
  const inner = `
    <p style="margin:0 0 10px">${approved ? 'Klient zatwierdził pliki w:' : 'Klient zgłosił poprawki do:'} <b>${esc(title)}</b></p>
    ${projectName ? `<p style="margin:2px 0;color:#64748b;font-size:13px">Projekt: ${esc(projectName)}</p>` : ''}
    ${name ? `<p style="margin:2px 0;color:#64748b;font-size:13px">Od: ${esc(name)}</p>` : ''}
    ${comment ? `<div style="margin:12px 0;padding:10px 14px;background:#f8fafc;border-left:3px solid ${esc(approved ? '#16a34a' : '#d97706')};white-space:pre-wrap">${esc(comment)}</div>` : ''}
    <p style="margin:14px 0 0">${btn(adminUrl, 'Zobacz w panelu', primary)}</p>`;
  const html = await wrap(inner, { heading });
  const text = `${heading}: ${title}\n${projectName ? 'Projekt: ' + projectName + '\n' : ''}${name ? 'Od: ' + name + '\n' : ''}${comment ? '\n' + comment + '\n' : ''}\n${adminUrl}`;
  const subject = `${appName} — ${approved ? 'zatwierdzono' : 'poprawki'}: ${title}`;
  return send({ to: config.admin.email, subject, html, text });
}

// Wysyłka linku do oferty na e-mail klienta (z panelu).
async function sendOfferLink({ to, url, offer, client, total }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const appName = s.appName || 'Evoke LINK';
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const validStr = offer.validUntil ? new Date(offer.validUntil).toLocaleDateString('pl-PL') : '';
  const inner = `
    <p style="margin:0 0 22px;color:#64748b">Przygotowaliśmy dla Ciebie ofertę <b style="color:#334155">${esc(offer.title)}</b>. Sprawdź szczegóły i zatwierdź.</p>
    ${amountBox(primary, money(total), 'brutto' + (validStr ? ` · ważna do ${validStr}` : ''))}
    <p style="margin:0 0 18px">${btn(url, 'Zobacz i zatwierdź ofertę', primary)}</p>
    <p style="margin:0;color:#94a3b8;font-size:13px">Lub skopiuj adres:<br><a href="${esc(url)}" style="color:${esc(primary)}">${esc(url)}</a></p>`;
  const html = await wrap(inner, { heading: 'Oferta dla Ciebie' });
  const text = `Oferta: ${offer.title}\nWartość: ${money(total)} brutto${validStr ? `\nWażna do: ${validStr}` : ''}\n\nZobacz i zatwierdź: ${url}`;
  return send({ to, subject: `${appName} — oferta: ${offer.title}`, html, text, replyTo: config.admin.email });
}

// Decyzja klienta o ofercie (akceptacja / odrzucenie z komentarzem) → mail do agencji.
async function sendOfferDecision({ offer, decision, comment, name, total }) {
  let s; try { s = await settingsService.get(); } catch (_) { s = settingsService.DEFAULTS; }
  const appName = s.appName || 'Evoke LINK';
  const primary = (s.colors && s.colors.primary) || '#6e00a5';
  const accepted = decision === 'accepted';
  const money = (g) => (g / 100).toFixed(2).replace('.', ',') + ' zł';
  const adminUrl = `${config.appUrl}/admin/clients/${offer.clientId}?tab=oferty`;
  const heading = accepted ? 'Oferta zaakceptowana ✓' : 'Oferta odrzucona';
  const inner = `
    <p style="margin:0 0 10px">${accepted ? 'Klient zaakceptował ofertę:' : 'Klient odrzucił ofertę:'} <b>${esc(offer.title)}</b></p>
    <p style="margin:2px 0;color:#64748b;font-size:13px">Wartość: ${esc(money(total))} brutto${offer.project ? ' · projekt: ' + esc(offer.project.name) : ''}</p>
    ${name ? `<p style="margin:2px 0;color:#64748b;font-size:13px">Od: ${esc(name)}</p>` : ''}
    ${comment ? `<div style="margin:12px 0;padding:10px 14px;background:#f8fafc;border-left:3px solid ${esc(accepted ? '#16a34a' : '#d97706')};white-space:pre-wrap">${esc(comment)}</div>` : ''}
    ${accepted ? '<p style="margin:10px 0;color:#64748b;font-size:13px">Pozycje z oferty trafiły do rozliczeń klienta.</p>' : ''}
    <p style="margin:14px 0 0">${btn(adminUrl, 'Zobacz w panelu', primary)}</p>`;
  const html = await wrap(inner, { heading });
  const text = `${heading}: ${offer.title}\nWartość: ${money(total)} brutto\n${name ? 'Od: ' + name + '\n' : ''}${comment ? '\n' + comment + '\n' : ''}\n${adminUrl}`;
  return send({ to: config.admin.email, subject: `${appName} — ${accepted ? 'zaakceptowano' : 'odrzucono'} ofertę: ${offer.title}`, html, text });
}

// Testowy e-mail do weryfikacji konfiguracji SMTP.
async function sendTest({ to }) {
  const inner = `<p style="margin:0 0 8px">To jest testowa wiadomość z Twojej instancji.</p>
    <p style="margin:0;color:#64748b;font-size:13px">Jeśli ją widzisz — wysyłka e-mail działa poprawnie. 🎉</p>`;
  const html = await wrap(inner, { heading: 'Test e-mail' });
  return send({ to, subject: 'Test e-mail — działa', html, text: 'Test e-mail — jeśli to widzisz, wysyłka działa.' });
}

module.exports = { send, isConfigured, PLACEHOLDERS, PLACEHOLDER_SUPPORT, sendUploadNotification, sendTransferLink, sendPanelLink, sendOnboardingLink, sendOnboardingCompleted, sendRetainerCharge, sendPaymentDeclared, sendDownloadNotification, sendUploadConfirmation, sendClientStatement, sendPaymentReminder, sendNewMessageNotification, sendClientReply, sendExpiryWarning, sendDailyDigest, sendProofingDecision, sendOfferLink, sendOfferDecision, sendTest };
