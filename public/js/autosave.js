// Auto-zapis wiersza (pozycje rozliczeniowe, retainery).
//
// ZASADA: zmiana pola + utrata fokusu → wysyłka CAŁEGO formularza. Kontroler buduje
// z body pełny obiekt pozycji, więc wysłanie samego zmienionego pola WYZEROWAŁOBY resztę
// (nazwę, VAT, daty). Dlatego zawsze leci komplet.
//
// GOTCHA NA STAŁE (błąd z v1.3.0): body MUSI iść jako `application/x-www-form-urlencoded`.
// `new FormData(form)` przekazany do fetch ustawia `multipart/form-data`, a aplikacja ma
// wpięte TYLKO `express.urlencoded` i `express.json` (src/app.js) — multipart nikt nie
// parsuje, więc `req.body` było PUSTE: kontroler nie miał czego zapisać, odpowiadał
// przekierowaniem, a skrypt pokazywał „Zapisano" mimo że nic się nie zmieniło.
// Stąd konwersja przez `URLSearchParams` (formularze auto-zapisu nie mają pól plikowych).
//
// Prosimy o JSON (`Accept`), żeby odróżnić sukces od odmowy zapisu — bez tego każda
// odpowiedź serwera wygląda dla nas jak przekierowanie, czyli „udało się".
// Zwykły submit (bez JS) dalej dostaje przekierowanie na stronę.
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var forms = document.querySelectorAll('form[data-autosave]');
    if (!forms.length) return;

    Array.prototype.forEach.call(forms, function (form) {
      // Zapasowy przycisk „Zapisz" jest potrzebny tylko bez JS — tutaj go chowamy.
      var nojs = form.querySelector('[data-nojs-save]');
      if (nojs) nojs.remove();

      var flash = form.querySelector('[data-saved]');
      var busy = false;
      var timer = null;

      function show(text, ok) {
        if (!flash) return;
        flash.textContent = text;
        flash.classList.toggle('text-green-600', ok !== false);
        flash.classList.toggle('text-red-600', ok === false);
        flash.style.opacity = '1';
        clearTimeout(timer);
        timer = setTimeout(function () { flash.style.opacity = '0'; }, 2000);
      }

      function save() {
        if (busy) return;
        busy = true;
        fetch(form.getAttribute('action'), {
          method: 'POST',
          credentials: 'same-origin',
          redirect: 'manual',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams(new FormData(form)),
        })
          .then(function (r) {
            // 204 = zapisane (odpowiedź dla auto-zapisu). 'opaqueredirect' = starsza ścieżka
            // z przekierowaniem. Odmowa zapisu (np. błędna kwota) przychodzi jako 4xx.
            if (r.ok || r.type === 'opaqueredirect') show('Zapisano');
            else show('Nie udało się zapisać', false);
          })
          .catch(function () { show('Brak połączenia — zmiana niezapisana', false); })
          .then(function () { busy = false; });
      }

      form.addEventListener('change', function (e) {
        if (e.target && e.target.name) save();
      });
      form.addEventListener('submit', function (e) {
        // UWAGA: „Usuń" to też submit, tylko z własnym `formaction` — tego NIE wolno
        // przechwytywać, bo przycisk przestałby działać. Przejmujemy wyłącznie zwykły
        // submit (np. Enter w polu tekstowym), żeby zapisał bez przeładowania.
        var btn = e.submitter;
        if (btn && btn.hasAttribute('formaction')) return;
        e.preventDefault();
        save();
      });
    });
  });
})();
