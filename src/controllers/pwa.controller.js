// PWA — publiczne endpointy: manifest aplikacji i zastępcza ikona (SVG).
// Manifest budowany z Settings (utils/pwa). Dostępne bez logowania (przeglądarka pobiera je sama).
const settingsService = require('../services/settings.service');
const pwa = require('../utils/pwa');

async function manifest(req, res, next) {
  try {
    const s = await settingsService.get();
    res.type('application/manifest+json');
    res.set('Cache-Control', 'no-cache');
    res.send(JSON.stringify(pwa.manifest(s)));
  } catch (err) {
    next(err);
  }
}

async function icon(req, res, next) {
  try {
    const s = await settingsService.get();
    res.type('image/svg+xml');
    // no-cache: ikona jest generowana z ustawień (logo/kolor/rozmiar) — podgląd i instalacja mają
    // odzwierciedlać bieżący stan po zapisie. Wariant maskable = trasa /pwa/icon-maskable.svg.
    res.set('Cache-Control', 'no-cache');
    res.send(pwa.iconSvg(s, { maskable: /maskable/.test(req.path) || req.query.mask === '1' }));
  } catch (err) {
    next(err);
  }
}

module.exports = { manifest, icon };
