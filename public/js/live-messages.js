// Żywy wątek wiadomości — komunikator agencji (/admin/messages) i wątek klienta (/p /c /t /upload /o).
//
// DLACZEGO POLLING: shared hosting + Passenger usypia proces, więc websockety/SSE są zawodne.
// Odpytujemy lekki endpoint co kilka sekund — „od razu" znaczy tu kilka sekund, za to niezawodnie.
//
// OSZCZĘDNIE (wzorzec z badges.js): pytamy TYLKO gdy karta jest widoczna, a po powrocie do karty
// odświeżamy natychmiast. Serwer zwraca GOTOWE bąbelki (ten sam partial co render strony), więc
// markupu nie ma w tym pliku — tutaj jest wyłącznie wstawianie, kursor i przewijanie.
//
// Konfiguracja z data-* kontenera wątku (`[data-live-thread]`):
//   data-poll-url  — endpoint pollingu, data-last-id — kursor, data-notify — natywne powiadomienie.
(function () {
  var EVERY = 5000; // ms — wątek odświeżamy częściej niż liczniki (badges.js: 60 s)

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var box = document.querySelector('[data-live-thread]');
    if (!box) return;
    var form = document.querySelector('[data-live-form]');
    var busy = false;
    var lastId = Number(box.getAttribute('data-last-id')) || 0;
    var wantNotify = box.hasAttribute('data-notify');

    function nearBottom() {
      return box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    }
    function toBottom() { box.scrollTop = box.scrollHeight; }

    // Wstawia bąbelki i USUWA duplikaty — przy wyścigu „wysyłka + trwający polling" ta sama
    // wiadomość mogłaby przyjść dwa razy (kursor pollingu jest sprzed wysyłki).
    function append(html) {
      if (!html) return 0;
      var stick = nearBottom();
      var empty = box.querySelector('[data-empty]');
      if (empty) empty.remove();
      var before = box.querySelectorAll('[data-msg-id]').length;
      box.insertAdjacentHTML('beforeend', html);
      var seen = {};
      Array.prototype.forEach.call(box.querySelectorAll('[data-msg-id]'), function (el) {
        var id = el.getAttribute('data-msg-id');
        if (seen[id]) el.remove(); else seen[id] = 1;
      });
      var added = box.querySelectorAll('[data-msg-id]').length - before;
      if (stick) toBottom();
      return added > 0 ? added : 0;
    }

    // Ptaszki: własne wiadomości przeczytane przez drugą stronę (uzupełniane w kolejnym kroku).
    function applyRead(ids) {
      if (!ids || !ids.length) return;
      ids.forEach(function (id) {
        var el = box.querySelector('[data-msg-id="' + id + '"] [data-ticks]');
        if (el) el.setAttribute('data-read', '1');
      });
    }

    function notify(count) {
      if (!wantNotify || count <= 0) return;
      if (document.visibilityState === 'visible') return;      // patrzysz na kartę — nie zawracamy głowy
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        var n = new Notification(count > 1 ? 'Nowe wiadomości (' + count + ')' : 'Nowa wiadomość', {
          body: 'Klient napisał w komunikatorze.',
          tag: 'evoke-messages',                                // jeden wątek zamiast zasypywania ekranu
        });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) { /* przeglądarka może odmówić — to tylko udogodnienie */ }
    }

    function poll() {
      if (busy || document.visibilityState !== 'visible') return;
      var url = box.getAttribute('data-poll-url');
      if (!url) return;
      busy = true;
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      fetch(url + sep + 'after=' + lastId, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          var added = append(d.html);
          applyRead(d.readIds);
          if (d.lastId) lastId = d.lastId;
          notify(added);
          // Licznik w menu mógł się zmienić (otwarta rozmowa = przeczytana) — odśwież bez czekania.
          if (added && window.evokeRefreshBadges) window.evokeRefreshBadges();
        })
        .catch(function () { /* offline / wygasła sesja — spróbujemy za chwilę */ })
        .then(function () { busy = false; });
    }

    setInterval(poll, EVERY);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') poll();
    });
    toBottom();

    // Wysyłka bez przeładowania: ten sam formularz, tylko przez fetch. Bez JS działa zwykły submit.
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = form.querySelector('button[type=submit]');
        if (btn) btn.disabled = true;
        fetch(form.getAttribute('action'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          body: new FormData(form),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (!d || !d.ok) { form.submit(); return; }               // coś poszło nie tak → klasyczny submit
            append(d.html);
            if (d.lastId) lastId = d.lastId;
            toBottom();
            form.reset();
            // Alpine trzyma podgląd nazwy załącznika i treści — wyzeruj, żeby chip zniknął.
            if (window.Alpine && form._x_dataStack) {
              var st = form._x_dataStack[0];
              if (st) { if ('fileName' in st) st.fileName = ''; if ('body' in st) st.body = ''; }
            }
            // Pierwsza wysyłka = naturalny moment na zgodę na powiadomienia (wymagany gest użytkownika).
            if (wantNotify && 'Notification' in window && Notification.permission === 'default') {
              try { Notification.requestPermission(); } catch (e) { /* starsze API */ }
            }
          })
          .catch(function () { form.submit(); })
          .then(function () { if (btn) btn.disabled = false; });
      });
    }
  });
})();
