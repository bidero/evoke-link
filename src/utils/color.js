// Z jednego koloru bazowego (#rrggbb = odpowiednik brand-600) generuje pełną
// paletę odcieni jako kanały "r g b" do nadpisania zmiennych CSS --brand-*.

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Miesza kolor z białym (t>0) lub czarnym (t<0). t w zakresie -1..1.
function mix([r, g, b], t) {
  const target = t >= 0 ? 255 : 0;
  const a = Math.abs(t);
  const ch = (c) => Math.round(c + (target - c) * a);
  return [ch(r), ch(g), ch(b)];
}

const STEPS = {
  50: 0.93,
  100: 0.85,
  200: 0.7,
  300: 0.5,
  400: 0.3,
  500: 0.12,
  600: 0,
  700: -0.15,
  800: -0.3,
  900: -0.45,
};

// Zwraca obiekt { '50': 'r g b', ... } albo null gdy hex niepoprawny.
function palette(hex) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const out = {};
  for (const [shade, t] of Object.entries(STEPS)) {
    out[shade] = mix(base, t).join(' ');
  }
  return out;
}

// Czytelny kolor tekstu (biały/ciemny) na danym tle — wg luminancji.
function readableText(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#0f172a';
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? '#0f172a' : '#ffffff';
}

// Walidacja #rrggbb; zwraca podany kolor albo fallback.
function safeHex(hex, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test((hex || '').trim()) ? hex.trim() : fallback;
}

module.exports = { hexToRgb, palette, readableText, safeHex };
