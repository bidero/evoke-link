// Sanityzacja własnego CSS podawanego przez admina.
// Admin jest zaufany, ale wstrzykujemy treść do <style>, więc neutralizujemy
// próbę wyrwania się ze znacznika: usuwamy znak '<' (CSS go nie używa — '</style>'
// staje się nieszkodliwym '/style>'). Znak '>' zostaje (kombinatory: .a > .b).
const MAX = 20000; // rozsądny limit długości

function sanitizeCss(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/</g, '').slice(0, MAX).trim();
}

module.exports = { sanitizeCss };
