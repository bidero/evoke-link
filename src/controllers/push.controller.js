// Panel: włączanie/wyłączanie powiadomień push na BIEŻĄCYM urządzeniu.
// Subskrypcja jest własnością przeglądarki (nie konta), więc każde urządzenie włącza je osobno
// — dokładnie jak passkeys.
const pushService = require('../services/push.service');
const settingsService = require('../services/settings.service');

// Klucz publiczny VAPID + stan włączenia — potrzebne przeglądarce przed subskrypcją.
async function config(req, res, next) {
  try {
    const s = await settingsService.get();
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: !!(s.pwa && s.pwa.enabled && s.pwa.push),
      publicKey: pushService.publicKey(),
    });
  } catch (err) {
    next(err);
  }
}

async function subscribe(req, res, next) {
  try {
    const s = await settingsService.get();
    if (!(s.pwa && s.pwa.enabled && s.pwa.push)) return res.status(403).json({ error: 'Powiadomienia są wyłączone w ustawieniach.' });

    const sub = req.body && req.body.subscription;
    const saved = await pushService.subscribe(sub, {
      userId: req.session && req.session.user ? req.session.user.id : null,
      ua: req.get('User-Agent'),
    });
    if (!saved) return res.status(400).json({ error: 'Nieprawidłowa subskrypcja.' });
    res.json({ ok: true, label: saved.label });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    await pushService.unsubscribe(req.body && req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// Powiadomienie testowe — jedyny sposób, żeby sprawdzić całą drogę (serwer → serwer push
// → service worker → banerek) bez czekania na realne zdarzenie.
async function test(req, res, next) {
  try {
    const r = await pushService.notify({
      title: 'Evoke LINK — test',
      body: 'Powiadomienia działają. To wiadomość testowa.',
      url: '/admin',
    });
    res.json(r && r.sent ? { ok: true, sent: r.sent } : { ok: false, ...r });
  } catch (err) {
    next(err);
  }
}

module.exports = { config, subscribe, unsubscribe, test };
