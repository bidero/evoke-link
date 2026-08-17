// Odświeżanie liczników w OTWARTEJ karcie panelu: dzwonek, badge menu (wiadomości,
// zadania) i licznik na ikonie zainstalowanej aplikacji (PWA).
//
// DLACZEGO: liczniki są renderowane serwerowo, więc bez tego są prawdziwe tylko w chwili
// wczytania strony — kto siedzi na jednym ekranie, nie zobaczyłby nowej wiadomości aż do
// przeładowania. Odpytujemy lekki `/admin/badges.json` (trzy COUNT-y) co minutę.
//
// OSZCZĘDNIE: pytamy tylko gdy karta jest WIDOCZNA (schowana zakładka nie generuje ruchu),
// a po powrocie do karty odświeżamy NATYCHMIAST — to najczęstszy moment, w którym liczba
// bywa nieaktualna. Elementy badge istnieją w HTML zawsze (przy zerze mają `hidden`),
// więc tu tylko podmieniamy liczbę i przełączamy klasę — zero dorabiania markupu.
//
// UWAGA: to NIE zastępuje powiadomień push. Przy ZAMKNIĘTEJ aplikacji nic się nie odświeża
// (licznik na ikonie zostaje z ostatniej znanej wartości) — do tego potrzebny byłby Web Push.
(function () {
  var URL = '/admin/badges.json';
  var EVERY = 60000; // ms
  var KEYS = ['notifications', 'messages', 'calendar'];
  var timer = null;
  var busy = false;

  function apply(data) {
    KEYS.forEach(function (k) {
      var n = Number(data[k]) || 0;
      var nodes = document.querySelectorAll('[data-badge="' + k + '"]');
      Array.prototype.forEach.call(nodes, function (el) {
        el.textContent = n;
        el.classList.toggle('hidden', n <= 0);
      });
    });
    // Licznik na ikonie aplikacji — suma „skrzynkowych" sygnałów (jak przy renderze strony).
    if (window.evokeAppBadge) window.evokeAppBadge((Number(data.notifications) || 0) + (Number(data.messages) || 0));
  }

  function refresh() {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    fetch(URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) apply(d); })
      .catch(function () { /* offline / wygasła sesja — spróbujemy za minutę */ })
      .then(function () { busy = false; });
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, EVERY);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh(); // powrót do karty = natychmiast
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.evokeRefreshBadges = refresh;
})();
