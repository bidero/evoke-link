// Pasek przewijania STRONY panelu, który zaczyna się POD nagłówkiem (desktop, mysz).
//
// Natywny pasek dokumentu zawsze biegnie od samej góry okna — także przez pasek nagłówka.
// Przeniesienie przewijania do kontenera treści (overflow) odpada: psuje zachowanie scrolla
// przy nawigacji Turbo i wywołuje glitch podglądów z backdrop-filter w Ustawieniach (GOTCHA
// z v0.99.12). Dlatego strona dalej przewija się normalnie (window), a natywny pasek dokumentu
// jest ukryty i zastąpiony cienkim wskaźnikiem `position:fixed` od dołu nagłówka do dołu okna,
// z odstępem od krawędzi. Da się go chwycić i przeciągnąć, a klik w tor przewija o ekran.
//
// Element dokładamy do <html> (nie do <body>) — Turbo podmienia <body> przy nawigacji, więc tak
// pasek przeżywa przejścia między stronami i inicjuje się tylko raz.
(function () {
  if (window.__evokePageScroll) return;
  window.__evokePageScroll = true;

  var GAP = 4;          // odstęp od nagłówka i od dołu okna (px)
  var MIN_THUMB = 32;   // minimalna wysokość kciuka
  var mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
  var root = document.documentElement;
  var track, thumb, ro, raf = 0, drag = null;

  function enabled() {
    return mq.matches && !root.classList.contains('hide-scrollbars') && !!document.querySelector('[data-admin-sidebar]');
  }

  function build() {
    track = document.createElement('div');
    track.className = 'page-scroll';
    track.setAttribute('aria-hidden', 'true');
    thumb = document.createElement('div');
    thumb.className = 'page-scroll-thumb';
    track.appendChild(thumb);
    root.appendChild(track);

    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      drag = { y: e.clientY, scroll: window.scrollY };
      thumb.setPointerCapture(e.pointerId);
      root.classList.add('page-scroll-dragging');
    });
    thumb.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var m = metrics();
      if (!m) return;
      var ratio = (m.doc - m.vh) / Math.max(1, m.trackH - m.thumbH);
      window.scrollTo(0, drag.scroll + (e.clientY - drag.y) * ratio);
    });
    function end() { drag = null; root.classList.remove('page-scroll-dragging'); }
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    // Klik w tor (poza kciukiem) = przewinięcie o ekran w stronę kliknięcia.
    track.addEventListener('pointerdown', function (e) {
      if (e.target !== track) return;
      var r = thumb.getBoundingClientRect();
      window.scrollBy({ top: (e.clientY < r.top ? -1 : 1) * window.innerHeight * 0.9, behavior: 'smooth' });
    });
  }

  function headerBottom() {
    var h = document.querySelector('body header');
    if (!h) return 0;
    var b = h.getBoundingClientRect().bottom;
    return b > 0 ? b : 0;
  }

  function metrics() {
    var doc = root.scrollHeight;
    var vh = window.innerHeight;
    if (doc <= vh + 1) return null;
    var top = headerBottom() + GAP;
    var trackH = vh - top - GAP;
    if (trackH < MIN_THUMB * 2) return null;
    var thumbH = Math.max(MIN_THUMB, Math.round(trackH * vh / doc));
    return { doc: doc, vh: vh, top: top, trackH: trackH, thumbH: thumbH };
  }

  function update() {
    raf = 0;
    var on = enabled();
    root.classList.toggle('has-page-scroll', on);
    if (!on) { if (track) track.style.display = 'none'; return; }
    if (!track) build();
    var m = metrics();
    if (!m) { track.style.display = 'none'; return; }
    track.style.display = '';
    track.style.top = m.top + 'px';
    track.style.height = m.trackH + 'px';
    thumb.style.height = m.thumbH + 'px';
    var max = m.doc - m.vh;
    var y = Math.min(1, Math.max(0, window.scrollY / max)) * (m.trackH - m.thumbH);
    thumb.style.transform = 'translateY(' + y + 'px)';
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(update); }

  // Treść zmienia wysokość (zakładki, akordeony, live wiadomości) — obserwujemy <body>,
  // a po nawigacji Turbo nowe <body> trzeba podpiąć od nowa.
  function observe() {
    if (!('ResizeObserver' in window)) return;
    if (ro) ro.disconnect();
    ro = new ResizeObserver(schedule);
    ro.observe(document.body);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if (mq.addEventListener) mq.addEventListener('change', schedule);
  document.addEventListener('turbo:load', function () { observe(); schedule(); });
  document.addEventListener('DOMContentLoaded', function () { observe(); schedule(); });
  if (document.readyState !== 'loading') { observe(); schedule(); }
})();
