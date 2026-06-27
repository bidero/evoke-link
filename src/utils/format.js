// Drobne pomocniki do wyświetlania. Dostępne w widokach przez res.locals.fmt.

// Czytelny rozmiar pliku. Przyjmuje Number lub BigInt (Prisma zwraca BigInt).
function bytes(value) {
  let b = typeof value === 'bigint' ? Number(value) : Number(value || 0);
  if (!b) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// Data po polsku: 25.06.2026, 14:30
function date(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Status transferu/projektu po polsku.
const STATUS_PL = {
  active: 'Aktywny',
  expired: 'Wygasły',
  deleted: 'Usunięty',
  archived: 'Zarchiwizowany',
};
function status(s) {
  return STATUS_PL[s] || s;
}

// Kwota trzymana w groszach (Int) → czytelnie „1 500,00 zł".
function money(grosze) {
  const n = Number(grosze || 0) / 100;
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

module.exports = { bytes, date, status, money };
