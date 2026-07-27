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
    res.set('Cache-Control', 'public, max-age=300');
    res.send(pwa.iconSvg(s));
  } catch (err) {
    next(err);
  }
}

module.exports = { manifest, icon };
