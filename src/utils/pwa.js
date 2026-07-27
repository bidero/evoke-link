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

// Zastępcza ikona: brandowy kwadrat z inicjałem nazwy (skalowalny SVG, zawsze instalowalny).
function iconSvg(s) {
  const color = themeColor(s);
  const fg = readableText(color) || '#ffffff';
  const initial = esc((appName(s).trim()[0] || 'E').toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img">`
    + `<rect width="512" height="512" rx="96" fill="${esc(color)}"/>`
    + `<text x="256" y="256" dy=".07em" text-anchor="middle" dominant-baseline="middle" `
    + `font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="280" font-weight="700" fill="${esc(fg)}">${initial}</text>`
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
      icons.push({ src: uploaded, sizes: '192x192', type, purpose: 'any' });
      icons.push({ src: uploaded, sizes: '512x512', type, purpose: 'any' });
      icons.push({ src: uploaded, sizes: '512x512', type, purpose: 'maskable' });
    }
  }
  // Zawsze dołóż skalowalny fallback — gwarantuje instalowalność nawet bez wgranej ikony.
  icons.push({ src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' });
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

module.exports = { manifest, iconSvg, headTags, appName, shortName, themeColor };
