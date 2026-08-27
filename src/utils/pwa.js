// PWA (instalowalna aplikacja): manifest, generowana ikona (SVG) i tagi <head>.
// Sterowane z Settings. Ikona składana z logo (pwa.logoPath) na kolorze marki — dwa warianty:
// zaokrąglony (any, desktop) i pełnokwadratowy (maskable, mobile — logo w strefie bezpiecznej).
const fs = require('fs');
const path = require('path');
const { readableText } = require('./color');

const PWA_SPLASH_MODES = ['icon', 'logo', 'name'];
const BRANDING_DIR = path.join(__dirname, '..', '..', 'public', 'branding');
const LOGO_EMBED_MAX = 1.5 * 1024 * 1024; // powyżej — nie osadzamy (byłaby ogromna ikona-SVG)

// Wgrany plik z public/branding/ → data URI (osadzenie w SVG ikony; brak zależności od zewn. ref).
// basename = ochrona przed path traversal (nazwy plików generuje multer, ale trzymamy się bezpiecznie).
function logoDataUri(p) {
  if (!p) return null;
  try {
    const file = path.join(BRANDING_DIR, path.basename(String(p)));
    const buf = fs.readFileSync(file);
    if (buf.length > LOGO_EMBED_MAX) return null;
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png'
      : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif' : null;
    return mime ? `data:${mime};base64,${buf.toString('base64')}` : null;
  } catch (e) { return null; }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Nazwa/kolory z sensownymi fallbackami (name→appName, themeColor→primary, background→biel).
function appName(s) { return (s.pwa && s.pwa.name) || s.appName || 'Evoke LINK'; }
function shortName(s) { return (s.pwa && s.pwa.shortName) || appName(s).slice(0, 12); }
function themeColor(s) { return (s.pwa && s.pwa.themeColor) || (s.colors && s.colors.primary) || '#6e00a5'; }
function bgColor(s) { return (s.pwa && s.pwa.background) || '#ffffff'; }

// Typ MIME wgranej ikony po rozszerzeniu (do deklaracji w manifeście).
function iconType(p) {
  if (/\.png$/i.test(p)) return 'image/png';
  if (/\.jpe?g$/i.test(p)) return 'image/jpeg';
  if (/\.webp$/i.test(p)) return 'image/webp';
  if (/\.svg$/i.test(p)) return 'image/svg+xml';
  return 'image/png';
}

function logoScale(s) {
  const n = parseInt(s.pwa && s.pwa.logoScale, 10);
  return Number.isFinite(n) ? Math.min(90, Math.max(30, n)) : 62;
}

// Generowana ikona (512×512): kolor marki + wyśrodkowana IKONA (pwa.iconPath, osadzona) albo inicjał.
// UWAGA: źródłem ikony jest `iconPath` (osobne pole „Ikona aplikacji") — NIE `logoPath` (to jest
// logo splashu, działa niezależnie). maskable=true → full-bleed (rx=0), OS nakłada maskę; grafika
// zmniejszona (×0.8) do strefy bezpiecznej. maskable=false → zaokrąglone rogi (rx=96) dla „any".
function iconSvg(s, opts) {
  const maskable = !!(opts && opts.maskable);
  const color = themeColor(s);
  const rx = maskable ? 0 : 96;
  const logo = logoDataUri(s.pwa && s.pwa.iconPath);
  let inner;
  if (logo) {
    const eff = (logoScale(s) / 100) * (maskable ? 0.8 : 1); // maskable: margines na maskę
    const size = Math.round(512 * eff);
    const off = Math.round((512 - size) / 2);
    // href + xlink:href — dla starszych rasteryzerów SVG. preserveAspectRatio zachowuje proporcje logo.
    inner = `<image href="${logo}" xlink:href="${logo}" x="${off}" y="${off}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    const fg = readableText(color) || '#ffffff';
    const initial = esc((appName(s).trim()[0] || 'E').toUpperCase());
    inner = `<text x="256" y="256" dy=".07em" text-anchor="middle" dominant-baseline="middle" `
      + `font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="${maskable ? 220 : 260}" font-weight="700" fill="${esc(fg)}">${initial}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512" role="img">`
    + `<rect width="512" height="512" rx="${rx}" fill="${esc(color)}"/>${inner}</svg>`;
}

// Obiekt manifestu (serwowany jako /manifest.webmanifest).
function manifest(s) {
  // Ikona ZAWSZE składana z `iconPath` (kolor marki + grafika w strefie bezpiecznej) — dwa OSOBNE
  // wpisy (nie łączony purpose; Safari używa `any`, ignoruje `maskable`): `any` = zaokrąglone rogi
  // (desktop), `maskable` = full-bleed, OS nakłada maskę (mobile). Osadzone jako data URI → brak
  // konkurencji z rastrem. Logo splashu (`logoPath`) NIE wpływa na ikonę.
  const icons = [
    { src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/pwa/icon.svg?mask=1', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ];
  return {
    name: appName(s),
    short_name: shortName(s),
    id: '/admin',
    start_url: '/admin',
    // ZASIĘG = TYLKO PANEL. To narzędzie agencji; strony klienta (/c /p /t /upload /o /onboard) są
    // „na zewnątrz" i mają otwierać się w PRZEGLĄDARCE, nie w oknie zainstalowanej aplikacji.
    // `scope` to jedyny mechanizm, który łapie WSZYSTKIE takie linki naraz (także przyszłe) —
    // `target="_blank"` na pojedynczych linkach bywa w standalone honorowany niekonsekwentnie.
    // Bez końcowego ukośnika CELOWO: dopasowanie jest prefiksowe, a `start_url` (/admin, bez
    // ukośnika) musi mieścić się w zasięgu — '/admin/' by go wykluczyło. Kolizji nie ma:
    // żadna inna trasa nie zaczyna się od „/admin".
    scope: '/admin',
    display: (s.pwa && s.pwa.display) || 'standalone',
    theme_color: themeColor(s),
    background_color: bgColor(s),
    lang: 'pl',
    dir: 'ltr',
    icons,
  };
}

// Tagi do <head> panelu/logowania (tylko gdy pwa.enabled). apple-touch-icon = wgrana ikona rastrowa
// albo favicon (iOS ignoruje SVG jako apple-touch — SVG zostaje w manifeście dla reszty).
function headTags(s) {
  if (!(s.pwa && s.pwa.enabled)) return '';
  // apple-touch wymaga rastra (iOS ignoruje SVG). Ikona aplikacji (raster) → favicon.
  // (logoPath to logo splashu — NIE ikona — więc go tu nie używamy.)
  const raster = (v) => (v && !/\.svg$/i.test(v)) ? v : '';
  const appleIcon = raster(s.pwa.iconPath) || raster(s.faviconPath) || '';
  return [
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<meta name="theme-color" content="${esc(themeColor(s))}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    `<meta name="apple-mobile-web-app-title" content="${esc(shortName(s))}">`,
    appleIcon ? `<link rel="apple-touch-icon" href="${esc(appleIcon)}">` : '',
    `<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>`,
  ].filter(Boolean).join('\n  ');
}

// Własny ekran startowy (splash): ikona + nazwa na tle startowym, pokazywany PO otwarciu
// ZAINSTALOWANEJ aplikacji przez zadany czas (pwa.splashMs), potem znika (fade). Natywny splash
// z manifestu bywa błyskiem przy szybkim starcie — to daje kontrolowany, brandowy ekran.
// Pokazywany TYLKO w trybie standalone (zainstalowana apka) i RAZ na uruchomienie (sessionStorage) —
// w przeglądarce natychmiast usuwany (bez błysku), przy kolejnych nawigacjach się nie powtarza.
function splashHtml(s) {
  const p = s.pwa || {};
  const ms = Math.min(5000, Math.max(0, parseInt(p.splashMs, 10) || 0));
  if (!p.enabled || !ms) return '';
  const bg = bgColor(s);
  const fg = readableText(bg) || '#0f172a';
  const nameHtml = `<div style="font:600 19px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-.01em;color:${esc(fg)};">${esc(appName(s))}</div>`;
  // Zawartość: logo brandingu / sama nazwa / ikona+nazwa (domyślnie). Na ciemnym tle bierzemy ciemny
  // wariant logo (logo.darkPath — zwykle jasny), żeby było widoczne.
  const mode = PWA_SPLASH_MODES.includes(p.splashMode) ? p.splashMode : 'icon';
  const dark = readableText(bg) === '#ffffff';
  // Logo splashu: najpierw osobne logo PWA, potem logo brandingu (na ciemnym tle wariant dark).
  const brandLogo = (dark && s.logo && s.logo.darkPath) ? s.logo.darkPath : s.logoPath;
  const logoSrc = p.logoPath || brandLogo;
  const sz = Math.max(48, parseInt(p.splashSize, 10) || 120); // wielkość grafiki (px) — bez górnego limitu
  // Caps na viewport: dowolnie duży px nie wyleje się poza ekran (object-fit zachowuje proporcje).
  const cap = 'max-width:88vw;max-height:74vh;';
  let inner;
  if (mode === 'name') {
    inner = `<div style="font:700 34px/1.15 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-.02em;color:${esc(fg)};text-align:center;padding:0 24px;">${esc(appName(s))}</div>`;
  } else if (mode === 'logo' && logoSrc) {
    // tryb „logo" = osobne logo splashu (pwa.logoPath) — niezależne od ikony aplikacji
    inner = `<img src="${esc(logoSrc)}" alt="" style="width:auto;height:${sz}px;${cap}object-fit:contain;" />`;
  } else { // tryb „ikona + nazwa" = złożona ikona aplikacji (/pwa/icon.svg, z iconPath)
    inner = `<img src="/pwa/icon.svg" alt="" style="width:${sz}px;height:${sz}px;${cap}border-radius:${Math.round(sz * 0.22)}px;object-fit:contain;" />${nameHtml}`;
  }
  return `<div id="evoke-splash" aria-hidden="true" style="position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:${esc(bg)};">`
    + inner
    + `</div>`
    + `<script>(function(){var e=document.getElementById('evoke-splash');if(!e)return;`
    + `var sa=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;var seen;`
    + `try{seen=sessionStorage.getItem('evoke-splash');}catch(x){}`
    + `if(!sa||seen){if(e.parentNode)e.parentNode.removeChild(e);return;}`
    + `try{sessionStorage.setItem('evoke-splash','1');}catch(x){}`
    + `e.style.display='flex';e.style.transition='opacity .45s ease';`
    + `setTimeout(function(){e.style.opacity='0';setTimeout(function(){if(e.parentNode)e.parentNode.removeChild(e);},480);},${ms});})();</script>`;
}

module.exports = { manifest, iconSvg, headTags, splashHtml, appName, shortName, themeColor };
