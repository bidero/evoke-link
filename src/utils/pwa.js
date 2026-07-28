// PWA (instalowalna aplikacja): manifest, ikona zastępcza (SVG) i tagi <head>.
// Wszystko sterowane z Settings (utils bez zależności od Express — czyste funkcje).
const { readableText } = require('./color');

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

// Zastępcza ikona: brandowy PEŁNOKWADRATOWY SVG z inicjałem nazwy. Full-bleed (bez zaokrągleń,
// bez przezroczystych rogów) → poprawny jako `maskable` (system sam nakłada maskę koła/squircle,
// a inicjał siedzi w strefie bezpiecznej ~font 260/512, więc nic się nie obcina). Używany też do
// auto-splash. Zawsze instalowalny bez uploadu.
function iconSvg(s) {
  const color = themeColor(s);
  const fg = readableText(color) || '#ffffff';
  const initial = esc((appName(s).trim()[0] || 'E').toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img">`
    + `<rect width="512" height="512" fill="${esc(color)}"/>`
    + `<text x="256" y="256" dy=".07em" text-anchor="middle" dominant-baseline="middle" `
    + `font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="260" font-weight="700" fill="${esc(fg)}">${initial}</text>`
    + `</svg>`;
}

// Obiekt manifestu (serwowany jako /manifest.webmanifest).
function manifest(s) {
  const icons = [];
  const uploaded = s.pwa && s.pwa.iconPath;
  if (uploaded) {
    const type = iconType(uploaded);
    if (type === 'image/svg+xml') {
      icons.push({ src: uploaded, sizes: 'any', type, purpose: 'any' });
    } else {
      // Wyłącznie `purpose: 'any'` — bez `maskable`. Kształtu wgranej ikony nie znamy, a maskable
      // kazałby systemowi przyciąć ją do koła/squircle (obcięte logo — pierwsze zgłoszenie usera).
      icons.push({ src: uploaded, sizes: '192x192', type, purpose: 'any' });
      icons.push({ src: uploaded, sizes: '512x512', type, purpose: 'any' });
    }
  } else {
    // Fallback (inicjał na kolorze marki) DOPIERO gdy nie ma wgranej ikony. GOTCHA: skalowalny SVG
    // POTRAFI wygrać z wgranym PNG w Chrome (przeglądarka woli wektor) i podmienić ikonę usera na
    // generyczny inicjał („ikona przestała działać"), więc przy wgranej ikonie NIE dokładamy fallbacku.
    // `purpose:'any'` (bez `maskable`): łączony „any maskable" bywał ignorowany przez Safari (nie zna
    // maskable) → brak ikony. Pełnokwadratowy SVG i tak wypełnia obszar, więc nic nie jest przycięte.
    icons.push({ src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' });
  }
  return {
    name: appName(s),
    short_name: shortName(s),
    id: '/admin',
    start_url: '/admin',
    scope: '/',
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
  const appleIcon = (s.pwa.iconPath && !/\.svg$/i.test(s.pwa.iconPath)) ? s.pwa.iconPath : (s.faviconPath && !/\.svg$/i.test(s.faviconPath) ? s.faviconPath : '');
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
  const iconSrc = p.iconPath ? esc(p.iconPath) : '/pwa/icon.svg';
  return `<div id="evoke-splash" aria-hidden="true" style="position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:${esc(bg)};">`
    + `<img src="${iconSrc}" alt="" style="width:104px;height:104px;border-radius:24px;object-fit:contain;" />`
    + `<div style="font:600 19px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-.01em;color:${esc(fg)};">${esc(appName(s))}</div>`
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
