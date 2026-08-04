// Wykres przychodu — wspólny rysownik dla widżetu pulpitu i strony Puls.
//
// DLACZEGO W JS, A NIE STATYCZNIE W EJS: SVG z samym `viewBox` i szerokością z CSS
// (bez jawnej wysokości) trzyma aspect-ratio z viewBox — przy poszerzaniu okna wysokość
// rośnie razem z szerokością, aż wypycha treść pod spodem (na pulpicie: poza stałą wysokość
// karty ustawianą przez `rows`). `preserveAspectRatio="none"` rozwiązałoby overflow, ale
// rozciągałoby kółka punktów w elipsy. Dlatego mierzymy REALNĄ szerokość kontenera
// (ResizeObserver — łapie też zwijanie paska bocznego, nie tylko resize okna) i rysujemy
// w prawdziwych pikselach: szerokość swobodna, wysokość ZAWSZE stała, kształty bez zniekształceń.
//
// KOLORY: przez zmienne CSS (--chart-*) ustawiane inline, NIE przez klasy
// Tailwinda — ten plik leży w public/js/, którego Tailwind nie skanuje, więc klasy
// `fill-*` zostałyby wycięte z buildu. Zmienne definiuje src/assets/css/input.css
// (mają też warianty w html.dark, więc wykres działa w trybie ciemnym).
(function () {
  // Wysokość jest STAŁA (nie zależy od szerokości): TOP = zapas na etykiety kwot nad serią,
  // +28 na oś z nazwami miesięcy pod spodem.
  var CH = 150, TOP = 18, BASE = TOP + CH, HEIGHT = BASE + 28;
  var NS = 'http://www.w3.org/2000/svg';
  // Marka przez zmienną — w dark mode input.css podmienia ją na jaśniejszy odcień.
  var BRAND = 'var(--chart-brand)';
  var BRAND_SOFT = 'var(--chart-brand-soft)';

  function zlShort(grosze) {
    // Etykiety muszą być KRÓTKIE (6 punktów w wąskim widżecie) i jednoznaczne: pełne złotówki
    // bez groszy, a skrót „tys." dopiero od 10 000 zł (przy niższym progu 5200 zł i 4600 zł
    // wyglądały identycznie jako „5 tys.").
    var zl = grosze / 100;
    return zl >= 10000 ? Math.round(zl / 1000) + ' tys.' : Math.round(zl).toLocaleString('pl-PL');
  }

  function svgEl(tag, attrs, styles) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    for (var s in styles) el.style[s] = styles[s];
    return el;
  }

  function draw(mount) {
    var svg = mount.querySelector('[data-chart-svg]');
    var data;
    try { data = JSON.parse(mount.dataset.chartData || '[]'); } catch (e) { data = []; }
    if (!svg || !data.length) return;
    var width = Math.round(mount.getBoundingClientRect().width);
    if (!width) return; // kontener jeszcze niewidoczny — poczeka na kolejny ResizeObserver

    // Typ wykresu pamiętany OSOBNO per strona (pulpit vs Puls) — klucz z data-chart-store.
    var storeKey = mount.dataset.chartStore || 'evoke-chart-type';
    var type = 'line';
    try { type = localStorage.getItem(storeKey) || 'line'; } catch (e) {}

    var n = data.length;
    var BW = width * (56 / 560); // proporcje słupków/odstępów jak w pierwotnym designie
    var GAP = (width - n * BW) / (n + 1);
    var maxV = Math.max(1, Math.max.apply(null, data.map(function (c) { return c.value; })));
    function cx(i) { return GAP + i * (BW + GAP) + BW / 2; }
    function cy(v) { return BASE - Math.round((v / maxV) * CH); }

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + HEIGHT);
    svg.innerHTML = '';

    var defs = svgEl('defs', {});
    var gradId = 'chartFill-' + (mount.dataset.chartId || 'x');
    var grad = svgEl('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-opacity': 0.28 }, { stopColor: BRAND }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-opacity': 0.02 }, { stopColor: BRAND }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Linia bazowa — wspólna dla obu wariantów.
    svg.appendChild(svgEl('line', { x1: 0, y1: BASE, x2: width, y2: BASE, 'stroke-width': 1 }, { stroke: 'var(--chart-axis)' }));

    if (type === 'bars') {
      data.forEach(function (c, i) {
        var y = cy(c.value), h = Math.max(3, BASE - y);
        svg.appendChild(svgEl('rect', { x: cx(i) - BW / 2, y: BASE - h, width: BW, height: h, rx: 6 },
          { fill: c.current ? BRAND : BRAND_SOFT }));
      });
    } else {
      var pts = data.map(function (c, i) { return [cx(i), cy(c.value)]; });
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ');
      var area = line + ' L' + pts[pts.length - 1][0] + ' ' + BASE + ' L' + pts[0][0] + ' ' + BASE + ' Z';
      svg.appendChild(svgEl('path', { d: area }, { fill: 'url(#' + gradId + ')' }));
      svg.appendChild(svgEl('path', { d: line, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' },
        { fill: 'none', stroke: BRAND }));
      pts.forEach(function (p, i) {
        svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: data[i].current ? 5 : 3.5, 'stroke-width': 2 },
          { fill: data[i].current ? BRAND : 'var(--chart-point)', stroke: BRAND }));
      });
    }

    // Kwoty i nazwy miesięcy — te same dla obu wariantów.
    data.forEach(function (c, i) {
      if (c.value > 0) {
        var amt = svgEl('text', { x: cx(i), y: cy(c.value) - 9, 'text-anchor': 'middle', 'font-size': 11 }, { fill: 'var(--chart-amount)' });
        amt.textContent = zlShort(c.value);
        svg.appendChild(amt);
      }
      var lbl = svgEl('text', { x: cx(i), y: BASE + 18, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': c.current ? 600 : 400 },
        { fill: c.current ? BRAND : 'var(--chart-label)' });
      lbl.textContent = c.label;
      svg.appendChild(lbl);
    });
  }

  function initAll() {
    var mounts = document.querySelectorAll('[data-chart-mount]');
    Array.prototype.forEach.call(mounts, function (mount, i) {
      if (mount.dataset.chartReady) return;
      mount.dataset.chartReady = '1';
      mount.dataset.chartId = String(i); // unikalne id gradientu, gdy wykresów jest kilka
      draw(mount);
      if (window.ResizeObserver) new ResizeObserver(function () { draw(mount); }).observe(mount);
      else window.addEventListener('resize', function () { draw(mount); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();

  // Wołane przez $watch('type', …) w Alpine przy przełączniku linia/słupki.
  // `root` = element widżetu/karty; przerysowuje wszystkie wykresy w środku.
  window.evokeChartRedraw = function (root) {
    var mounts = (root || document).querySelectorAll('[data-chart-mount]');
    Array.prototype.forEach.call(mounts, draw);
  };
  window.evokeChartInit = initAll;
})();
