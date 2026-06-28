// Pary fontów dla stron klienta (nagłówki / tekst). Wyłącznie czcionki systemowe —
// zero pobierania, działa offline i nie łamie CSP ('self'). Wstrzykiwane jako <style>.
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const SERIF = "ui-serif, Georgia, 'Times New Roman', serif";
const MONO = "ui-monospace, 'Cascadia Code', 'Segoe UI Mono', Consolas, monospace";

const PAIRS = {
  system: { label: 'Domyślny (sans)', heading: SANS, body: SANS },
  serif: { label: 'Serif nagłówki', heading: SERIF, body: SANS },
  editorial: { label: 'Elegancki (serif)', heading: SERIF, body: SERIF },
  mono: { label: 'Techniczny (mono)', heading: MONO, body: SANS },
};
const DEFAULT = 'system';

// <style> nadpisujący font tekstu i nagłówków. Domyślny = brak nadpisania (zostaje Tailwind/system).
function styleTag(key) {
  if (!PAIRS[key] || key === DEFAULT) return '';
  const p = PAIRS[key];
  return `<style>body{font-family:${p.body}}h1,h2,h3,h4,h5,h6{font-family:${p.heading}}</style>`;
}

module.exports = { PAIRS, DEFAULT, styleTag };
