// Helper renderujący logo z obsługą trybu jasny/ciemny.
// Używany jako logoTag() w szablonach (jak icon()) — działa też w layoutach,
// gdzie EJS-owy include() jest niedostępny (express-ejs-layouts).
// Caller sam sprawdza `settings.logoPath` i zapewnia fallback (tekst/inicjał).

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// settings — obiekt ustawień (z logoPath i logo.darkPath).
// opts: { appName, imgClass, imgStyle }
function logoTag(settings, opts = {}) {
  if (!settings || !settings.logoPath) return '';
  const appName = opts.appName || settings.appName || '';
  const cls = opts.imgClass || '';
  const styleAttr = opts.imgStyle ? ` style="${esc(opts.imgStyle)}"` : '';
  const darkPath = settings.logo && settings.logo.darkPath;
  const img = (src, extraCls) =>
    `<img src="${esc(src)}" alt="${esc(appName)}"${styleAttr} class="${esc((cls + ' ' + extraCls).trim())}" />`;
  if (darkPath) {
    return img(settings.logoPath, 'dark:hidden') + img(darkPath, 'hidden dark:inline');
  }
  return img(settings.logoPath, '');
}

module.exports = { logoTag };
