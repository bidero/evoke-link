// Helper renderujący logo z obsługą trybu jasny/ciemny i POWIERZCHNI (klient/logowanie/admin).
// Używany jako logoTag() w szablonach (jak icon()) — działa też w layoutach,
// gdzie EJS-owy include() jest niedostępny (express-ejs-layouts).

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rozwiązuje parę (jasne, ciemne) dla powierzchni. Reguła: jeśli powierzchnia ma WŁASNE
// jasne logo, ciemne bierzemy tylko z jej pary (własne ciemne || własne jasne) — bez mieszania
// z globalnym ciemnym (mogłoby nie pasować). Bez własnego jasnego → globalna para.
function resolve(settings, surface) {
  const L = (settings && settings.logo) || {};
  const own = surface === 'admin' ? { light: L.adminPath, dark: L.adminDarkPath }
    : surface === 'login' ? { light: L.loginPath, dark: L.loginDarkPath }
    : { light: null, dark: null };
  if (own.light) return { light: own.light, dark: own.dark || null };
  return { light: (settings && settings.logoPath) || null, dark: L.darkPath || null };
}

// Czy dana powierzchnia ma jakiekolwiek logo (do warunku w widoku przed fallbackiem „E").
function hasLogo(settings, surface) {
  return !!resolve(settings, surface).light;
}

// opts: { appName, imgClass, imgStyle, surface: 'client' (domyślnie) | 'login' | 'admin' }
function logoTag(settings, opts = {}) {
  const { light, dark } = resolve(settings, opts.surface);
  if (!light) return '';
  const appName = opts.appName || (settings && settings.appName) || '';
  const cls = opts.imgClass || '';
  const styleAttr = opts.imgStyle ? ` style="${esc(opts.imgStyle)}"` : '';
  const img = (src, extraCls) =>
    `<img src="${esc(src)}" alt="${esc(appName)}"${styleAttr} class="${esc((cls + ' ' + extraCls).trim())}" />`;
  if (dark) {
    return img(light, 'dark:hidden') + img(dark, 'hidden dark:inline');
  }
  return img(light, '');
}

module.exports = { logoTag, hasLogo };
