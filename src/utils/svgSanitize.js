const fs = require('fs');

// Lekka sanityzacja SVG (bez zależności / jsdom — bezpieczne na shared hostingu).
// SVG wgrane jako logo/favicon serwujemy przez <img>, co już blokuje wykonanie
// skryptów, ale czyścimy plik na wszelki wypadek (np. otwarcie URL-a wprost).
// Usuwa: <script>, <foreignObject>, atrybuty on*=, javascript:, DOCTYPE/ENTITY (XXE),
// oraz zewnętrzne odwołania href/xlink:href (zostają tylko #fragmenty i data:image/*).

function sanitizeSvg(input) {
  if (typeof input !== 'string') return '';
  let s = input;

  // DOCTYPE / deklaracje encji (ochrona przed XXE / bombami encji).
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  s = s.replace(/<!ENTITY[\s\S]*?>/gi, '');

  // Elementy wykonujące kod lub osadzające obcą treść.
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<script[\s\S]*?\/>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  s = s.replace(/<(iframe|object|embed|audio|video)[\s\S]*?<\/\1\s*>/gi, '');

  // Atrybuty zdarzeń: onload, onclick, onmouseover, ...
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // javascript:/vbscript: w dowolnym atrybucie.
  s = s.replace(/(href|xlink:href|src)\s*=\s*"\s*(javascript|vbscript)\s*:[^"]*"/gi, '$1=""');
  s = s.replace(/(href|xlink:href|src)\s*=\s*'\s*(javascript|vbscript)\s*:[^']*'/gi, "$1=''");

  // Zewnętrzne odwołania (http/https/protocol-relative) — zostawiamy tylko #frag i data:image/*.
  s = s.replace(/(href|xlink:href|src)\s*=\s*"(?!\s*(#|data:image\/))[^"]*"/gi, '$1=""');
  s = s.replace(/(href|xlink:href|src)\s*=\s*'(?!\s*(#|data:image\/))[^']*'/gi, "$1=''");

  return s.trim();
}

// Czy zawartość wygląda na SVG.
function looksLikeSvg(input) {
  return typeof input === 'string' && /<svg[\s>]/i.test(input);
}

// Po wgraniu pliku graficznego: jeśli to SVG, oczyść go NA DYSKU (XSS/XXE).
// Wspólne dla wszystkich uploadów brandingu (ustawienia, profil, awatar klienta).
function sanitizeIfSvg(file) {
  if (!file) return;
  const isSvg = /svg/i.test(file.mimetype) || /\.svg$/i.test(file.originalname);
  if (!isSvg) return;
  try {
    const raw = fs.readFileSync(file.path, 'utf8');
    if (looksLikeSvg(raw)) fs.writeFileSync(file.path, sanitizeSvg(raw), 'utf8');
  } catch (_) { /* nie blokuj zapisu przez błąd I/O */ }
}

module.exports = { sanitizeSvg, looksLikeSvg, sanitizeIfSvg };
