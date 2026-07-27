// Evoke LINK — minimalny service worker (instalowalność PWA / okno aplikacji).
// ŚWIADOMIE bez cache'owania: apka jest dynamiczna (SSR, sesje, świeży CSS po deployu),
// więc SW tylko rejestruje się i przepuszcza żądania do sieci. Obecność fetch-handlera
// spełnia kryterium instalowalności, a brak cache = zero ryzyka podania nieświeżej strony.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough — przeglądarka obsługuje żądanie normalnie */ });
