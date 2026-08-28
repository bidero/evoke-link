// Auto-zapis wiersza (pozycje rozliczeniowe, retainery).
//
// ZASADA: zmiana pola + utrata fokusu → wysyłka CAŁEGO formularza. Kontroler buduje
// z body pełny obiekt pozycji, więc wysłanie samego zmienionego pola WYZEROWAŁOBY resztę
// (nazwę, VAT, daty). Dlatego zawsze leci komplet.
//
// Odpowiedź to przekierowanie na stronę — `redirect: 'manual'` zatrzymuje je po naszej
// stronie, żeby nie ściągać całego HTML-a przy każdej zmianie pola.
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
          body: new FormData(form),
        })
          .then(function (r) {
            // 'opaqueredirect' = serwer odpowiedział przekierowaniem, czyli zapis przeszedł.
            if (r.type === 'opaqueredirect' || r.ok) show('Zapisano');
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
