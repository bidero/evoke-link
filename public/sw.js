// Evoke LINK — minimalny service worker (instalowalność PWA / okno aplikacji + Web Push).
// ŚWIADOMIE bez cache'owania: apka jest dynamiczna (SSR, sesje, świeży CSS po deployu),
// więc SW tylko rejestruje się i przepuszcza żądania do sieci. Obecność fetch-handlera
// spełnia kryterium instalowalności, a brak cache = zero ryzyka podania nieświeżej strony.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough — przeglądarka obsługuje żądanie normalnie */ });

// ── Web Push ────────────────────────────────────────────────────────────────
// To JEDYNY moment, w którym aplikacja może się odezwać przy ZAMKNIĘTYM oknie:
// przeglądarka budzi service workera, my pokazujemy banerek i ustawiamy licznik na ikonie.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  const title = d.title || 'Evoke LINK';
  const body = d.body || '';
  const url = d.url || '/admin';

  event.waitUntil((async () => {
    // Licznik na ikonie — działa też wtedy, gdy użytkownik zignoruje banerek.
    if (typeof d.badge === 'number' && self.registration) {
      try {
        if (d.badge > 0 && self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(d.badge);
        else if (self.navigator && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      } catch (e) { /* brak API/uprawnień — trudno */ }
    }
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa/icon.svg',
      badge: '/pwa/icon.svg',
      // Jeden „wątek": kolejne powiadomienia podmieniają poprzednie zamiast zasypywać ekran.
      tag: 'evoke-link',
      renotify: true,
      data: { url },
    });
  })());
});

// Klik w banerek: podnosimy już otwarte okno aplikacji (zamiast mnożyć kolejne),
// a gdy żadnego nie ma — otwieramy nowe pod wskazanym adresem.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { if ('navigate' in c) await c.navigate(url); } catch (e) { /* inne origin — trudno */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
