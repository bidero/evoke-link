// Awatar klienta — JEDNO miejsce na cały wygląd (lista, kartoteka 360°, kanban, komunikator, paleta).
// Wgrane logo (Client.avatarPath) → <img>; brak → kółko z inicjałem i STABILNYM kolorem z nazwy
// (ten sam klient zawsze ten sam kolor, bez trzymania czegokolwiek w bazie).

// Paleta 8 par (tło + tekst) — Tailwind ich nie skanuje, bo klasy budujemy tu literalnie.
// Świadomie BEZ koloru marki: awatary mają odróżniać klientów, a brand jest zarezerwowany
// dla akcji i stanów aktywnych (inaczej „wszystko jest fioletowe").
const PALETTE = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-orange-100 text-orange-700',
];

// Rozmiary: klasa kółka + rozmiar czcionki inicjału.
const SIZES = {
  xs: { box: 'w-6 h-6', text: 'text-[10px]' },
  sm: { box: 'w-8 h-8', text: 'text-sm' },
  md: { box: 'w-10 h-10', text: 'text-base' },
  lg: { box: 'w-14 h-14', text: 'text-xl' },
};

function initial(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  // Pierwsza litera pierwszego „słowa" — z pominięciem znaków, które nie są literą/cyfrą.
  const m = s.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '?';
}

// Stabilny hash nazwy → indeks palety (djb2; bez zależności, deterministyczny).
function colorFor(name) {
  const s = String(name || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// html(client, { size, cls }) → gotowy element. `client` = { name, avatarPath }.
function html(client, opts = {}) {
  const c = client || {};
  const sz = SIZES[opts.size] || SIZES.sm;
  const extra = opts.cls ? ' ' + opts.cls : '';
  const box = `${sz.box} rounded-full shrink-0${extra}`;
  if (c.avatarPath) {
    return `<img src="${esc(c.avatarPath)}" alt="" class="${box} object-cover border border-black/10 bg-white" />`;
  }
  return `<span class="${box} ${colorFor(c.name)} inline-flex items-center justify-center ${sz.text} font-semibold" aria-hidden="true">${esc(initial(c.name))}</span>`;
}

module.exports = { html, initial, colorFor, PALETTE, SIZES };
