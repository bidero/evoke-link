// Kontekstowy link „wstecz" w adminie. Strony detalu (projekt/transfer/klient) mają zaszyty domyślny
// link „← Wszystkie X"; gdy wejdziesz z konkretnego miejsca, link wejściowy dokleja `?from=<token>`,
// a tu zamieniamy token na { href, label }, żeby powrót prowadził TAM, skąd przyszedłeś.
//
// Token = `<typ>:<id>` (client/project) albo samo `<typ>` (board/calendar/sales) albo
// `search:<zapytanie>`. Whitelist typów → żaden dowolny URL (bez open-redirect); w widoku i tak
// tylko jako href (EJS auto-escape). Nieznany/pusty token → null (widok pokazuje domyślny link).

function toId(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function resolve(from) {
  if (!from || typeof from !== 'string') return null;
  const i = from.indexOf(':');
  const type = i === -1 ? from : from.slice(0, i);
  const rest = i === -1 ? '' : from.slice(i + 1);
  switch (type) {
    case 'client': { const id = toId(rest); return id ? { href: `/admin/clients/${id}`, label: 'Wróć do klienta' } : null; }
    case 'project': { const id = toId(rest); return id ? { href: `/admin/projects/${id}`, label: 'Wróć do projektu' } : null; }
    case 'board': return { href: '/admin/projects/board', label: 'Wróć do tablicy' };
    case 'calendar': return { href: '/admin/calendar', label: 'Wróć do kalendarza' };
    case 'sales': return { href: '/admin/sales', label: 'Wróć do sprzedaży' };
    case 'search': return rest ? { href: `/admin/search?q=${encodeURIComponent(rest)}`, label: 'Wróć do wyników' } : null;
    default: return null;
  }
}

module.exports = { resolve };
