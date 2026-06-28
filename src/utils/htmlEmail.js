// Lekka sanityzacja HTML treści maili (z edytora WYSIWYG) + zrzut do czystego tekstu.
// Treści tworzy zaufany administrator i trafiają wyłącznie do wysyłanych maili
// (nie są renderowane w panelu), więc celem jest spójny, bezpieczny HTML maila:
// dozwolone tylko tagi formatujące, usunięcie skryptów/handlerów/niebezpiecznych linków.

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'p', 'br', 'div', 'span', 'h3']);

function sanitizeEmailHtml(input) {
  let s = String(input || '');
  // Wytnij niebezpieczne bloki w całości.
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|title)[\s\S]*?(<\/\s*\1\s*>|$)/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Przejdź po tagach: zostaw dozwolone (bez atrybutów, poza href w <a>), resztę usuń zachowując tekst.
  s = s.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (m, slash, tagRaw, attrs) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (slash) return `</${tag}>`;
    if (tag === 'a') {
      const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      let href = hm ? (hm[2] || hm[3] || hm[4] || '') : '';
      if (!/^(https?:|mailto:|\/|#)/i.test(href)) href = '';
      return href ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">` : '<a>';
    }
    return `<${tag}>`;
  });
  return s.trim();
}

// HTML → czysty tekst (alternatywa text/plain w mailu).
function stripTags(input) {
  return String(input || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h3)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sanitizeEmailHtml, stripTags };
