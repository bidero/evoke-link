// Przyklejony nagłówek: blur/tło pojawia się płynnie dopiero po rozpoczęciu przewijania.
// Init jest RE-URUCHAMIALNY (window.evokeStickyInit) — po nawigacji Turbo `<body>` jest podmieniany,
// więc trzeba ponownie znaleźć element. Listener scrolla podpinamy RAZ do `window` (przeżywa
// podmianę body); `el` odświeżamy przy każdym init.
(function () {
  var el = null;
  function upd() {
    if (!el) return;
    if (window.scrollY > 8) el.classList.add('evoke-scrolled');
    else el.classList.remove('evoke-scrolled');
  }
  function init() {
    el = document.querySelector('[data-sticky-header]');
    upd();
  }
  window.addEventListener('scroll', upd, { passive: true });
  window.evokeStickyInit = init;
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
