// Dane do przelewu + kod QR wg rekomendacji ZBP (kod 2D — skan w aplikacji banku).
// Format payloadu: NIP|PL|konto(26 cyfr NRB)|kwota w groszach (min 6 cyfr)|odbiorca(20)|tytuł(32)|||

// Numer konta z ustawień (może mieć spacje/kreski/prefiks PL) → 26 cyfr NRB lub null.
function bankDigits(bank) {
  const d = String(bank || '').replace(/\D/g, '');
  return d.length === 26 ? d : null;
}

function zbpPayload({ nip, account, amountGr, name, title }) {
  if (!account) return null;
  const amt = String(Math.max(0, Math.round(amountGr || 0))).padStart(6, '0');
  const field = (v, n) => String(v || '').replace(/\|/g, ' ').trim().slice(0, n);
  // Odbiorca: spec ZBP mówi o 20 znakach, ale aplikacje banków parsują po `|` i przyjmują
  // dłuższe pola — 20 ucinało nazwisko w połowie. 40 mieści pełną nazwę, a całość payloadu
  // (stałe pola 52 + tytuł 32 + odbiorca 40) i tak zostaje poniżej limitu 160 znaków.
  return `${String(nip || '').replace(/\D/g, '')}|PL|${account}|${amt}|${field(name, 40)}|${field(title, 32)}|||`;
}

module.exports = { bankDigits, zbpPayload };
