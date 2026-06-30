// Kod QR jako inline SVG (bez JS po stronie klienta → czyste CSP, działa też w druku/mailu).
// Lekki, czysto-JS qrcode-generator (zero zależności natywnych — „shared-hosting-safe").
const qrcode = require('qrcode-generator');

// text → string z <svg>. cell = rozmiar modułu (px), margin = „quiet zone" w modułach.
// color/bg: QR musi mieć wysoki kontrast (ciemny na jasnym), żeby się dobrze skanował.
function svg(text, { cell = 4, margin = 2, color = '#0f172a', bg = '#ffffff' } = {}) {
  const data = String(text == null ? '' : text);
  if (!data) return '';
  const qr = qrcode(0, 'M'); // typ auto, korekcja błędów M (~15%) — sensowna dla URL
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const size = (count + margin * 2) * cell;
  let rects = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        rects += `<rect x="${(c + margin) * cell}" y="${(r + margin) * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Kod QR z linkiem">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/><g fill="${color}">${rects}</g></svg>`
  );
}

module.exports = { svg };
