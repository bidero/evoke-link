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
  plain: {
    label: 'Czysta biel',
    css: '#ffffff',
  },
};

const DEFAULT_PRESET = 'brand-soft';

// Czy preset jest ciemny (do wyboru jasnego tekstu na stronie).
const DARK_PRESETS = new Set(['dusk']);

const TYPES = ['gradient', 'custom', 'image', 'solid'];

const DEFAULTS = {
  type: 'gradient', // gradient | custom | image | solid
  preset: DEFAULT_PRESET,
  color: '#f4f6fb',
  // własny gradient: 2–3 przystanki + kąt
  custom: { c1: '#6e00a5', c2: '#a31fde', c3: '', angle: 135 },
  imagePath: null,
  overlay: 0, // przyciemnienie obrazu 0..80 (%)
  imageGradient: false, // nakładka gradientu na obraz
  imageGrad: { c1: '#6e00a5', c2: '', angle: 135 }, // kolory nakładki na obraz (c2 pusty = zanik)
  grain: false,
  grainType: 'fine', // fine | soft | coarse — charakter ziarna
  grainStrength: 50, // moc szumu 0..100 (%)
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
  return {
    c1: safeHex(x.c1, DEFAULTS.imageGrad.c1),
    c2: safeHex(x.c2, '') || '', // pusty = zanik do przezroczystości
    angle: Math.min(360, Math.max(0, parseInt(x.angle, 10) || DEFAULTS.imageGrad.angle)),
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
  return {
    type,
    preset,
    color: safeHex(b.color, DEFAULTS.color),
    custom: normCustom(b.custom),
    imagePath: b.imagePath || null,
    overlay,
    imageGradient: !!b.imageGradient,
    imageGrad: normImageGrad(b.imageGrad),
    grain: !!b.grain,
    grainType: GRAIN_TYPES.includes(b.grainType) ? b.grainType : DEFAULTS.grainType,
    grainStrength,
  };
}

// Inline `style` dla <body>.
function bodyStyle(bg) {
  const b = normalize(bg);
  if (b.type === 'solid') return `background:${b.color};`;
  if (b.type === 'custom') return `background:${customCss(b.custom)};`;
  if (b.type === 'image' && b.imagePath) {
    return `background:#0f172a url('${b.imagePath}') center/cover no-repeat fixed;`;
  }
  return `background:${(PRESETS[b.preset] || PRESETS[DEFAULT_PRESET]).css};`;
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
  const c1 = rgba(g.c1, 0.6);
  const c2 = g.c2 ? rgba(g.c2, 0.38) : 'rgba(0,0,0,0)';
  return `linear-gradient(${g.angle}deg, ${c1} 0%, ${c2} 55%, rgba(0,0,0,0) 100%)`;
}

// HTML nakładek wstawianych na początku <body> (pod treścią). Stałe pozycjonowanie,
// pointer-events:none, niski z-index — nie przeszkadzają w interakcji.
// Kolejność warstw: gradient na obrazie → przyciemnienie → ziarno.
function overlayHtml(bg) {
  const b = normalize(bg);
  let html = '';
  if (b.type === 'image' && b.imagePath && b.imageGradient) {
    html += `<div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;background:${imageGradientCss(b.imageGrad)};"></div>`;
  }
  if (b.type === 'image' && b.imagePath && b.overlay > 0) {
    html += `<div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;background:rgba(15,23,42,${(b.overlay / 100).toFixed(2)});"></div>`;
  }
  if (b.grain && b.grainStrength > 0) {
    const g = GRAIN[b.grainType] || GRAIN.fine;
    const op = ((b.grainStrength / 100) * g.max).toFixed(3);
    html += `<div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;mix-blend-mode:${g.blend};opacity:${op};background-image:url(&quot;${grainUri(g)}&quot;);background-size:${g.size}px ${g.size}px;"></div>`;
  }
  return html;
}

module.exports = { PRESETS, DEFAULTS, normalize, bodyStyle, overlayHtml, isDark, customCss };
