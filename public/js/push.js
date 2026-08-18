// Powiadomienia push — włączenie/wyłączenie na BIEŻĄCYM urządzeniu.
// Subskrypcja należy do przeglądarki (nie do konta), więc każde urządzenie włącza je osobno,
// dokładnie jak passkeys. Wymaga service workera (/sw.js), zgody użytkownika i HTTPS
// (albo localhost). Na iPhonie działa TYLKO dla aplikacji dodanej do ekranu głównego (iOS 16.4+).
(function () {
  // base64url z klucza VAPID → Uint8Array, którego oczekuje pushManager.subscribe.
  function urlB64ToUint8(base64) {
    var pad = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function ready() {
    // Rejestracja SW jest w layoucie (tagi PWA); tu tylko czekamy na gotowość.
    return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return ready().then(function (reg) { return reg.pushManager.getSubscription(); });
  }

  async function enable() {
    if (!supported()) throw new Error('Ta przeglądarka nie obsługuje powiadomień push.');

    var cfg = await fetch('/admin/push/config', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
    if (!cfg.enabled) throw new Error('Powiadomienia są wyłączone w Ustawieniach → Zaawansowane.');
    if (!cfg.publicKey) throw new Error('Brak klucza serwera (VAPID).');

    var perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Nie wyrażono zgody na powiadomienia w przeglądarce.');

    var reg = await ready();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // wymagane przez przeglądarki: każdy push musi coś pokazać
        applicationServerKey: urlB64ToUint8(cfg.publicKey),
      });
    }

    var res = await fetch('/admin/push/subscribe', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }),
    });
    if (!res.ok) {
      var e = await res.json().catch(function () { return {}; });
      throw new Error(e.error || 'Serwer odrzucił subskrypcję.');
    }
    return true;
  }

  async function disable() {
    var sub = await currentSubscription();
    if (!sub) return true;
    // Najpierw serwer (żeby nie wysyłał już na martwy endpoint), potem przeglądarka.
    await fetch('/admin/push/unsubscribe', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(function () {});
    await sub.unsubscribe().catch(function () {});
    return true;
  }

  async function test() {
    var res = await fetch('/admin/push/test', { method: 'POST', credentials: 'same-origin' });
    var d = await res.json().catch(function () { return {}; });
    if (!d.ok) throw new Error(d.error || 'Nie udało się wysłać powiadomienia testowego.');
    return d.sent;
  }

  // Czy TO urządzenie ma włączone powiadomienia (zgoda + istniejąca subskrypcja)?
  async function status() {
    if (!supported()) return { supported: false, on: false, permission: 'unsupported' };
    var sub = await currentSubscription().catch(function () { return null; });
    return { supported: true, on: !!sub, permission: Notification.permission };
  }

  window.evokePush = { supported: supported, status: status, enable: enable, disable: disable, test: test };
})();
