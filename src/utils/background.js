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
  grain: false,
  grainStrength: 50, // moc szumu 0..100 (%)
};

function normCustom(c) {
  const x = c && typeof c === 'object' ? c : {};
  return {
    c1: safeHex(x.c1, DEFAULTS.custom.c1),
    c2: safeHex(x.c2, DEFAULTS.custom.c2),
    c3: safeHex(x.c3, '') || '', // pusty = gradient 2-kolorowy
    angle: Math.min(360, Math.max(0, parseInt(x.angle, 10) || 0)),
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
    grain: !!b.grain,
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
  if (b.type === 'image') return b.overlay >= 35;
  if (b.type === 'solid') return readableText(b.color) === '#ffffff';
  if (b.type === 'custom') return readableText(b.custom.c1) === '#ffffff' && readableText(b.custom.c2) === '#ffffff';
  return false;
}

// Ziarno (szum) jako lekka nakładka SVG w data-URI — bez zewnętrznych zasobów (CSP-friendly).
const GRAIN_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E";

// HTML nakładek wstawianych na początku <body> (pod treścią). Stałe pozycjonowanie,
// pointer-events:none, niski z-index — nie przeszkadzają w interakcji.
function overlayHtml(bg) {
  const b = normalize(bg);
  let html = '';
  if (b.type === 'image' && b.imagePath && b.overlay > 0) {
    html += `<div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;background:rgba(15,23,42,${(b.overlay / 100).toFixed(2)});"></div>`;
  }
  if (b.grain && b.grainStrength > 0) {
    const op = (b.grainStrength / 100).toFixed(2);
    html += `<div aria-hidden="true" style="position:fixed;inset:0;z-index:0;pointer-events:none;mix-blend-mode:soft-light;opacity:${op};background-image:url(\"${GRAIN_URI}\");background-size:160px 160px;"></div>`;
  }
  return html;
}

module.exports = { PRESETS, DEFAULTS, normalize, bodyStyle, overlayHtml, isDark, customCss };
