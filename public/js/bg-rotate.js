// Rotacja teł (slideshow) — cykluje warstwy .bg-slide przez płynny crossfade.
// Warstwy + interwał (data-bg-rotate, w sekundach) generuje utils/background.slideshowHtml.
(function () {
  function init() {
    var box = document.querySelector('[data-bg-rotate]');
    if (!box) return;
    var slides = box.querySelectorAll('.bg-slide');
    if (slides.length < 2) return;
    var sec = Math.max(3, parseInt(box.getAttribute('data-bg-rotate'), 10) || 8);
    var cur = 0;
    setInterval(function () {
      var nextIdx = (cur + 1) % slides.length;
      var prev = cur;
      slides[nextIdx].style.opacity = '1';            // nowa warstwa wchodzi (crossfade)
      setTimeout(function () { slides[prev].style.opacity = '0'; }, 1300);
      cur = nextIdx;
    }, sec * 1000);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
