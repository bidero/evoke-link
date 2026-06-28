// Przyklejony nagłówek: blur/tło pojawia się płynnie dopiero po rozpoczęciu przewijania.
(function () {
  var el = document.querySelector('[data-sticky-header]');
  if (!el) return;
  function upd() {
    if (window.scrollY > 8) el.classList.add('evoke-scrolled');
    else el.classList.remove('evoke-scrolled');
  }
  window.addEventListener('scroll', upd, { passive: true });
  upd();
})();
