// Pobieranie plików w zainstalowanej aplikacji na iOS (standalone).
//
// PROBLEM: WebKit w trybie standalone IGNORUJE atrybut `download` i NAWIGUJE okno aplikacji
// na plik. Okno standalone nie ma paska przeglądarki, więc użytkownik ląduje na natywnym
// ekranie „Otwórz w «Podgląd»" BEZ DROGI POWROTNEJ — jedynym wyjściem jest ubicie apki.
//
// FIX: klik prosi panel o krótkotrwały PODPISANY link (`/dl/:token`, 60 s, jednorazowy).
// Adres jest poza `scope: '/admin'`, więc otwiera się POZA oknem aplikacji, a że autoryzuje
// go podpis, a nie sesja — działa mimo że web-apka ma w iOS osobne ciasteczka niż Safari.
//
// ZAKRES: tylko iOS w standalone. W Chrome (desktop/Android) atrybut `download` działa
// poprawnie i skrypt świadomie się nie wtrąca.
//
// GOTCHA NA STAŁE — NIE UŻYWAĆ TU `window.open`: wzorzec „otwórz puste okno w geście,
// potem podstaw adres" (poprawny na blokady popupów w Chrome) w iOS standalone NIE DZIAŁA.
// Okno się otwiera, ale zwrócony uchwyt jest ZERWANY — `win.location = …` nie ma żadnego
// skutku i wewnętrzna przeglądarka zostaje na `about:blank`, bez wyjątku i bez błędu
// (czyli `catch` nie łapie, degradacja się nie uruchamia). Zgłoszone z iPhone'a po v1.0.3.
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var standalone = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var ua = navigator.userAgent || '';
  // iPadOS podaje się za Maca — rozpoznajemy po dotyku.
  var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  ready(function () {
    if (!standalone || !ios) return;

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[download][data-dl]');
      if (!a) return;
      var marker = (a.getAttribute('data-dl') || '').split(':');
      var kind = marker[0];
      if (!kind || !marker[1]) return;
      e.preventDefault();

      var fallback = function () {
        window.location.href = a.href;   // dotychczasowe zachowanie — nie gorzej niż było
      };

      fetch('/admin/dl-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ kind: kind, id: marker[1], extra: marker[2] || null }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.url) return fallback();
          // Nawigacja BIEŻĄCEGO okna na adres spoza `scope` — iOS przejmuje ją i otwiera
          // wewnętrzną przeglądarkę (to samo, co robi z linkami /c i /p), a okno panelu
          // zostaje na swoim miejscu. Odpowiedź jest załącznikiem, więc kończy się arkuszem
          // zapisu z przyciskiem „Gotowe".
          window.location.href = d.url;
        })
        .catch(fallback);
    });
  });
})();
