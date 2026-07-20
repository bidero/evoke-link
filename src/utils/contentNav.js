// Pas pionowy (portalNav rail-*) na stronach TREŚCI (/t, /upload, /o) — bez sekcji,
// tylko Wiadomości jako link (+ hamburger i tryb ciemny dokłada layout).
// Zwracamy portalNav WYŁĄCZNIE w trybie rail-*: inne warianty nawigacji nie renderują
// nic na tych stronach (brak sekcji), a dostęp do wiadomości daje pływająca koperta-link.

function isRail(res) {
  return String(res.locals.portalNavMode || '').indexOf('rail') === 0;
}

// Pas na stronie treści: pozycja „Wiadomości" (dot = nowa odpowiedź).
function contentRailNav(res, { msgHref, msgDot }) {
  if (!isRail(res)) return null;
  return {
    sections: [{ key: 'wiadomosci', label: 'Wiadomości', icon: 'mail', action: 'messages', href: msgHref, dot: !!msgDot }],
    keys: [], defaultSec: null, railOpen: false,
  };
}

// Pas na PODSTRONIE wiadomości strony treści: powrót + Wiadomości (aktywne).
function contentMsgNav(res, { backHref, backLabel, msgHref }) {
  if (!isRail(res)) return null;
  return {
    sections: [
      { key: 'wstecz', label: backLabel, icon: 'arrowLeft', action: 'back', href: backHref },
      { key: 'wiadomosci', label: 'Wiadomości', icon: 'mail', action: 'messages', href: msgHref, active: true },
    ],
    keys: [], defaultSec: null, railOpen: false,
  };
}

module.exports = { contentRailNav, contentMsgNav };
