// Tło stron klienta/logowania: rotacja slideshow + odświeżenie „szkła".
// (1) Slideshow — cykluje warstwy .bg-slide crossfadem (interwał: data-bg-rotate, sekundy).
// (2) Fix artefaktu „gradientu za kartą szkło": warstwa tła (position:fixed) odsłania się
//     opacity 0→1 po załadowaniu zdjęcia, JUŻ PO pierwszym malowaniu karty z backdrop-filter.
//     Na części GPU karta trzyma nieświeżą próbkę tła (ciemny/gradientowy pas przy tytule,
//     znikający dopiero przy scroll/resize). Po odsłonięciu wymuszamy re-sample backdropu:
//     na jedną klatkę mocniejszy blur (22px), potem powrót do wartości z CSS — przeglądarka
//     przelicza backdrop, a różnica 22→14px jest niezauważalna.
// Init jest RE-URUCHAMIALNY (window.evokeBgInit) — po nawigacji Turbo `<body>` jest podmieniany,
// więc odsłonięcie tła i re-sample „szkła" trzeba odpalić ponownie; slideshow interval jest
// czyszczony przy każdym init, żeby nie stackować `setInterval`.
(function () {
  var slideTimer = null;
  // Wymusza ponowne próbkowanie backdrop-filter: na JEDNĄ klatkę mocniejszy blur, potem powrót.
  // Zmiana wartości filtra (nie usunięcie) każe przeglądarce przeliczyć backdrop, a przejście
  // 22px→14px jest niezauważalne (w przeciwieństwie do blur→none→blur, które daje ostry błysk).
  function refreshGlass() {
    // Tylko karty (nie sticky-header: startuje przezroczysty, re-sampluje się przy scrollu).
    var els = document.querySelectorAll('.evoke-card, .evoke-panel');
    if (!els.length) return;
    for (var i = 0; i < els.length; i++) {
      els[i].style.backdropFilter = 'blur(22px)';
      els[i].style.webkitBackdropFilter = 'blur(22px)';
    }
    requestAnimationFrame(function () {
      for (var j = 0; j < els.length; j++) {
        els[j].style.backdropFilter = '';     // powrót do blur z klasy .evoke-card (var(--card-blur))
        els[j].style.webkitBackdropFilter = '';
      }
    });
  }
  function scheduleRefresh() {
    requestAnimationFrame(function () { requestAnimationFrame(refreshGlass); });
  }

  function initGlass() {
    // Bug dotyczy tylko tła obrazkowego (warstwa fixed odsłaniana opacity 0→1 po onload).
    // Preloader to <img aria-hidden> tuż za .bg-img-layer (jego onload odsłania warstwę).
    var pre = document.querySelector('.bg-img-layer ~ img[aria-hidden="true"]');
    if (!pre) return; // solid/gradient tło — brak odsłaniania, brak artefaktu, nie ruszamy kart
    if (pre.complete) scheduleRefresh();       // zdjęcie z cache (onload zdążył przed skryptem)
    else pre.addEventListener('load', scheduleRefresh);
  }

  function initSlides() {
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null; } // re-init: nie stackuj interwału
    var box = document.querySelector('[data-bg-rotate]');
    if (!box) return;
    var slides = box.querySelectorAll('.bg-slide');
    if (slides.length < 2) return;
    var sec = Math.max(3, parseInt(box.getAttribute('data-bg-rotate'), 10) || 8);
    var cur = 0;
    slideTimer = setInterval(function () {
      var nextIdx = (cur + 1) % slides.length;
      var prev = cur;
      slides[nextIdx].style.opacity = '1';            // nowa warstwa wchodzi (crossfade)
      setTimeout(function () { slides[prev].style.opacity = '0'; }, 1300);
      cur = nextIdx;
    }, sec * 1000);
  }

  function init() { initGlass(); initSlides(); }
  window.evokeBgInit = init;
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
