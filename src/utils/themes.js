// Gotowe motywy całościowe — jeden klik ustawia spójny pakiet: kolor + tło + układ + typografia.
// Stosowane przez merge w bieżące ustawienia (logo/treści/maile/PDF zostają nietknięte).
const THEMES = {
  'studio-light': {
    label: 'Studio (jasny)',
    colors: { primary: '#6e00a5' },
    background: { type: 'gradient', preset: 'brand-soft' },
    layout: { style: 'centered', card: 'solid', font: 'system', radius: 24, button: 'rounded', stickyHeader: false },
  },
  'studio-dark': {
    label: 'Studio (ciemny)',
    colors: { primary: '#8b5cf6' },
    background: { type: 'gradient', preset: 'nebula' },
    layout: { style: 'showcase', card: 'glass', cardSide: 'center', font: 'system', radius: 20, button: 'pill', stickyHeader: false },
  },
  editorial: {
    label: 'Elegancki (serif)',
    colors: { primary: '#b45309' },
    background: { type: 'gradient', preset: 'spotlight' },
    layout: { style: 'split', card: 'elevated', cardSide: 'right', font: 'editorial', radius: 8, button: 'rounded', stickyHeader: false },
  },
  wetransfer: {
    label: 'Pełne tło (WeTransfer)',
    colors: { primary: '#2563eb' },
    background: { type: 'gradient', preset: 'mesh' },
    layout: { style: 'panel', card: 'solid', cardSide: 'left', font: 'system', radius: 16, button: 'rounded', stickyHeader: true },
  },
};

module.exports = { THEMES };
