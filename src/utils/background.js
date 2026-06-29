// Tło stron klienta (publicznych). Z konfiguracji Settings.background buduje
// inline-CSS dla <body> oraz opcjonalną nakładkę (obraz/ziarno).
// Presety gradientów korzystają ze zmiennych --brand-* (paleta koloru przewodniego),
// więc tło automatycznie podąża za wybranym kolorem — bez rebuildu CSS.
const { safeHex, readableText } = require('./color');

// Każdy preset to gotowy `background:` dla body.
const PRESETS = {
  'brand-soft': {
    label: 'Brand — delikatny',
    css: 'linear-gradient(135deg, rgb(var(--brand-50)) 0%, #ffffff 50%, rgb(var(--brand-100)) 100%)',
  },
  'brand-vivid': {
    label: 'Brand — wyrazisty',
    css: 'linear-gradient(135deg, rgb(var(--brand-100)) 0%, rgb(var(--brand-300)) 100%)',
  },
  aurora: {
    label: 'Aurora',
    css: 'radial-gradient(120% 120% at 0% 0%, rgb(var(--brand-200)) 0%, transparent 45%), radial-gradient(120% 120% at 100% 0%, rgb(var(--brand-100)) 0%, transparent 50%), linear-gradient(180deg, #ffffff, rgb(var(--brand-50)))',
  },
  dusk: {
    label: 'Zmierzch (ciemny)',
    css: 'linear-gradient(160deg, rgb(var(--brand-900)) 0%, rgb(var(--brand-700)) 60%, rgb(var(--brand-800)) 100%)',
  },
  // --- Art pack: kuratorowane tła „bohater" (CSS, brandowe, bez uploadu) ---
  mesh: {
    label: 'Mesh (kolorowa mgła)',
    css: 'radial-gradient(at 18% 22%, rgb(var(--brand-200)) 0px, transparent 50%), radial-gradient(at 82% 8%, rgb(var(--brand-100)) 0px, transparent 50%), radial-gradient(at 8% 82%, rgb(var(--brand-300)) 0px, transparent 50%), radial-gradient(at 88% 88%, rgb(var(--brand-50)) 0px, transparent 50%), #ffffff',
  },
  spotlight: {
    label: 'Reflektor',
    css: 'radial-gradient(80% 60% at 50% -10%, rgb(var(--brand-200)) 0%, transparent 60%), linear-gradient(180deg, #ffffff 0%, rgb(var(--brand-50)) 100%)',
  },
  midnight: {
    label: 'Mesh nocny (ciemny)',
    css: 'radial-gradient(at 15% 15%, rgb(var(--brand-700)) 0px, transparent 50%), radial-gradient(at 85% 10%, rgb(var(--brand-800)) 0px, transparent 55%), radial-gradient(at 50% 92%, rgb(var(--brand-900)) 0px, transparent 50%), #0b0b14',
  },
  nebula: {
    label: 'Mgławica (ciemny)',
    css: 'radial-gradient(60% 80% at 20% 20%, rgb(var(--brand-600)) 0%, transparent 55%), radial-gradient(70% 70% at 90% 80%, rgb(var(--brand-800)) 0%, transparent 55%), linear-gradient(160deg, #0f0a1f 0%, rgb(var(--brand-900)) 100%)',
  },
  plain: {
    label: 'Czysta biel',
    css: '#ffffff',
  },
};

const DEFAULT_PRESET = 'brand-soft';

// Czy preset jest ciemny (do wyboru jasnego tekstu na stronie).
const DARK_PRESETS = new Set(['dusk', 'midnight', 'nebula']);

const TYPES = ['gradient', 'custom', 'image', 'solid'];

const DEFAULTS = {
  type: 'gradient', // gradient | custom | image | solid
  preset: DEFAULT_PRESET,
  color: '#f4f6fb',
  // własny gradient: 2–3 przystanki + kąt
  custom: { c1: '#6e00a5', c2: '#a31fde', c3: '', angle: 135 },
  imagePath: null,
  images: [], // wiele obrazów tła (do rotacji); imagePath = pierwszy (zgodność wstecz)
  rotate: false, // slideshow — automatyczna zmiana obrazów
  rotateSec: 8, // co ile sekund (3..30)
  overlay: 0, // przyciemnienie obrazu 0..80 (%)
  imageGradient: false, // nakładka gradientu na obraz
  imageGrad: { c1: '#6e00a5', a1: 60, c3: '', a3: 60, c2: '', a2: 60, angle: 135 }, // nakładka na obraz: c1=góra, c3=środek (opc.), c2=dół (pusty=zanik); aN = alpha danego koloru 0..100
  grain: false,
  grainType: 'fine', // fine | soft | coarse — charakter ziarna
  grainStrength: 50, // moc szumu 0..100 (%)
  scroll: false, // tło przesuwa się z przewijaniem (zamiast przyklejonego/fixed)
};

const GRAIN_TYPES = ['fine', 'soft', 'coarse'];

function normCustom(c) {
  const x = c && typeof c === 'object' ? c : {};
  return {
    c1: safeHex(x.c1, DEFAULTS.custom.c1),
    c2: safeHex(x.c2, DEFAULTS.custom.c2),
    c3: safeHex(x.c3, '') || '', // pusty = gradient 2-kolorowy
    angle: Math.min(360, Math.max(0, parseInt(x.angle, 10) || 0)),
  };
}

function normImageGrad(g) {
  const x = g && typeof g === 'object' ? g : {};
  const a = parseInt(x.angle, 10); // ZACHOWUJ 0 — `|| default` mylił 0° z brakiem wartości
  const al = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };
  return {
    c1: safeHex(x.c1, DEFAULTS.imageGrad.c1), a1: al(x.a1, DEFAULTS.imageGrad.a1), // góra / start
    c3: safeHex(x.c3, '') || '', a3: al(x.a3, DEFAULTS.imageGrad.a3), // środek (opcjonalny)
    c2: safeHex(x.c2, '') || '', a2: al(x.a2, DEFAULTS.imageGrad.a2), // dół / koniec (pusty = zanik)
    angle: Number.isFinite(a) ? Math.min(360, Math.max(0, a)) : DEFAULTS.imageGrad.angle,
  };
}

// Złożenie własnego gradientu z przystanków.
function customCss(c) {
  const stops = [c.c1, c.c2, c.c3].filter(Boolean);
  if (stops.length < 2) stops.push(stops[0] || '#ffffff');
  return `linear-gradient(${c.angle}deg, ${stops.join(', ')})`;
}

function normalize(bg) {
  const b = bg && typeof bg === 'object' ? bg : {};
  const type = TYPES.includes(b.type) ? b.type : DEFAULTS.type;
  const preset = PRESETS[b.preset] ? b.preset : DEFAULTS.preset;
  const overlay = Math.min(80, Math.max(0, parseInt(b.overlay, 10) || 0));
  const grainStrength = Math.min(100, Math.max(0, parseInt(b.grainStrength, 10) || (b.grainStrength === 0 ? 0 : DEFAULTS.grainStrength)));
  // Lista obrazów (do rotacji). Zgodność wstecz: gdy brak listy, użyj pojedynczego imagePath.
  let images = Array.isArray(b.images) ? b.images.filter((p) => typeof p === 'string' && p) : [];
  if (!images.length && b.imagePath) images = [b.imagePath];
  const rs = parseInt(b.rotateSec, 10);
  return {
    type,
    preset,
    color: safeHex(b.color, DEFAULTS.color),
    custom: normCustom(b.custom),
    imagePath: images[0] || null, // pierwszy obraz z listy = tło statyczne (źródło prawdy)
    images,
    rotate: !!b.rotate,
    rotateSec: Math.min(30, Math.max(3, Number.isFinite(rs) ? rs : DEFAULTS.rotateSec)),
    overlay,
    imageGradient: !!b.imageGradient,
    imageGrad: normImageGrad(b.imageGrad),
    grain: !!b.grain,
    grainType: GRAIN_TYPES.includes(b.grainType) ? b.grainType : DEFAULTS.grainType,
    grainStrength,
    scroll: !!b.scroll,
  };
}

// Inline `style` dla <body>. `scroll` → tło i nakładki przewijają się z treścią
// (wymaga position:relative na body, by nakładki `absolute` objęły całą wysokość).
function bodyStyle(bg) {
  const b = normalize(bg);
  const rel = b.scroll ? 'position:relative;' : '';
  if (b.type === 'solid') return `${rel}background:${b.color};`;
  if (b.type === 'custom') return `${rel}background:${customCss(b.custom)};`;
  if (b.type === 'image') {
    const img = b.images[0] || b.imagePath;
    // Obraz renderujemy jako pozycjonowaną warstwę w overlayHtml (NIE background-attachment:fixed
    // na <body> — to naprawia brak malowania obrazu do czasu resize na niektórych GPU/przeglądarkach,
    // ujawniany przy włączonym szumie/mix-blend-mode). Body daje tylko ciemny kolor bazowy.
    if (img) return `${rel}background:#0f172a;`;
  }
  return `${rel}background:${(PRESETS[b.preset] || PRESETS[DEFAULT_PRESET]).css};`;
}

// Czy tło jest ciemne (do wyboru jasnego tekstu na stronie).
function isDark(bg) {
  const b = normalize(bg);
  if (b.type === 'gradient') return DARK_PRESETS.has(b.preset);
  if (b.type === 'image') return b.overlay >= 35 || b.imageGradient;
  if (b.type === 'solid') return readableText(b.color) === '#ffffff';
  if (b.type === 'custom') return readableText(b.custom.c1) === '#ffffff' && readableText(b.custom.c2) === '#ffffff';
  return false;
}

// Ziarno (szum) — 3 charaktery. Miękki blend (soft-light) i ograniczone krycie
// dają „artystyczny" film grain zamiast ostrego śnieżenia. Bez zewnętrznych zasobów.
const GRAIN = {
  fine: { f: 0.85, o: 2, blend: 'soft-light', max: 0.5, size: 160 },
  soft: { f: 0.55, o: 3, blend: 'soft-light', max: 0.42, size: 220 },
  coarse: { f: 0.34, o: 4, blend: 'soft-light', max: 0.34, size: 300 },
};
function grainUri(g) {
  return (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + g.size + "' height='" + g.size +
    "'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='" + g.f + "' numOctaves='" + g.o +
    "' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"
  );
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgba(0,0,0,${a})`;
}

// Gradient nakładany na obraz tła z konfiguracji (kolory + kąt). c2 pusty = zanik.
function imageGradientCss(g) {
  const al = (v) => Math.min(100, Math.max(0, v == null ? 60 : v)) / 100; // alpha danego koloru
  const stops = [`${rgba(g.c1, al(g.a1))} 0%`]; // góra
  if (g.c3) stops.push(`${rgba(g.c3, al(g.a3))} 50%`); // środek (opcjonalny)
  stops.push(`${g.c2 ? rgba(g.c2, al(g.a2)) : 'rgba(0,0,0,0)'} 100%`); // dół: kolor lub zanik do przezroczystości
  return `linear-gradient(${g.angle}deg, ${stops.join(', ')})`;
}

// HTML nakładek wstawianych na początku <body> (pod treścią). Stałe pozycjonowanie,
// pointer-events:none, niski z-index — nie przeszkadzają w interakcji.
// Kolejność warstw: gradient na obrazie → przyciemnienie → ziarno.
function overlayHtml(bg) {
  const b = normalize(bg);
  const pos = b.scroll ? 'absolute' : 'fixed';
  const img = b.images[0] || b.imagePath;
  const slideshowActive = b.type === 'image' && b.rotate && b.images.length >= 2;
  let html = '';
  // Obraz tła jako pozycjonowana warstwa (bez background-attachment:fixed). Slideshow ma własne warstwy.
  if (b.type === 'image' && img && !slideshowActive) {
    html += `<div aria-hidden="true" class="bg-img-layer" style="position:${pos};inset:0;z-index:0;pointer-events:none;background:#0f172a url('${img}') center/cover no-repeat;"></div>`;
  }
  if (b.type === 'image' && img && b.imageGradient) {
    html += `<div aria-hidden="true" style="position:${pos};inset:0;z-index:0;pointer-events:none;background:${imageGradientCss(b.imageGrad)};"></div>`;
  }
  if (b.type === 'image' && img && b.overlay > 0) {
    html += `<div aria-hidden="true" style="position:${pos};inset:0;z-index:0;pointer-events:none;background:rgba(15,23,42,${(b.overlay / 100).toFixed(2)});"></div>`;
  }
  if (b.grain && b.grainStrength > 0) {
    const g = GRAIN[b.grainType] || GRAIN.fine;
    const op = ((b.grainStrength / 100) * g.max).toFixed(3);
    html += `<div aria-hidden="true" style="position:${pos};inset:0;z-index:0;pointer-events:none;mix-blend-mode:${g.blend};opacity:${op};background-image:url(&quot;${grainUri(g)}&quot;);background-size:${g.size}px ${g.size}px;"></div>`;
  }
  return html;
}

// Warstwy slideshow (rotacja obrazów) — pełnoekranowe, pod treścią; cykluje je /js/bg-rotate.js.
function slideshowHtml(bg) {
  const b = normalize(bg);
  if (b.type !== 'image' || !b.rotate || b.images.length < 2) return '';
  const pos = b.scroll ? 'absolute' : 'fixed';
  const layers = b.images.map((src, i) =>
    `<div class="bg-slide" style="position:${pos};inset:0;z-index:0;pointer-events:none;background:#0f172a url('${src}') center/cover no-repeat;opacity:${i === 0 ? 1 : 0};transition:opacity 1.2s ease;"></div>`
  ).join('');
  return `<div data-bg-rotate="${b.rotateSec}" aria-hidden="true">${layers}</div>`;
}

module.exports = { PRESETS, DEFAULTS, normalize, bodyStyle, overlayHtml, slideshowHtml, isDark, customCss };
