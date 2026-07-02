// Rozliczenia — pozycje kwotowe projektu. Kwoty w GROSZACH (Int).
const prisma = require('../db/client');

// "1500,50" / "1 500.50" / "1500" → grosze (Int). Niepoprawne → 0.
function parseAmount(input) {
  if (input == null) return 0;
  const n = parseFloat(String(input).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

// Dozwolone stawki VAT (%). '' / brak → null (pozycja bez VAT, netto = brutto).
const VAT_RATES = [23, 8, 5, 0];
function parseVatRate(v) {
  if (v == null || v === '' || v === 'none') return null;
  const n = parseInt(v, 10);
  return VAT_RATES.includes(n) ? n : null;
}

// Kwota VAT pozycji (grosze). Brak stawki → 0.
function vatOf(c) {
  return c.vatRate ? Math.round((c.amount * c.vatRate) / 100) : 0;
}
// Kwota brutto pozycji (netto + VAT).
function grossOf(c) {
  return c.amount + vatOf(c);
}

// Podsumowanie z tablicy pozycji (grosze). Kwoty brutto (z VAT) w total/paid/outstanding
// dla zgodności ze starym API; dodatkowo rozbicie net/vat/gross.
function totals(charges) {
  let net = 0;
  let vat = 0;
  let paid = 0;
  (charges || []).forEach((c) => {
    net += c.amount;
    vat += vatOf(c);
    if (c.paidAt) paid += grossOf(c);
  });
  const gross = net + vat;
  return { net, vat, gross, total: gross, paid, outstanding: gross - paid };
}

function getById(id) {
  return prisma.charge.findUnique({ where: { id: Number(id) } });
}

// Pozycja z klientem projektu — do weryfikacji właściciela przy edycji ze strony klienta.
function getByIdWithProject(id) {
  return prisma.charge.findUnique({ where: { id: Number(id) }, include: { project: { select: { clientId: true } } } });
}

// Klient, do którego należy pozycja: bezpośredni clientId, inaczej z projektu.
function ownerClientId(charge) {
  if (charge.clientId != null) return charge.clientId;
  return charge.project ? charge.project.clientId : null;
}

// Liczba pozycji przypiętych WPROST do klienta (bez projektu) — blokada usunięcia klienta.
function directCount(clientId) {
  return prisma.charge.count({ where: { clientId: Number(clientId) } });
}

function listByProject(projectId) {
  return prisma.charge.findMany({ where: { projectId: Number(projectId) }, orderBy: { createdAt: 'asc' } });
}

// Tworzy pozycję projektową (projectId) ALBO bezprojektową (clientId). Zawsze jedno z nich.
function create({ projectId, clientId, label, amount, vatRate, note, date, dueDate }) {
  const pid = projectId ? Number(projectId) : null;
  const cid = clientId ? Number(clientId) : null;
  return prisma.charge.create({
    data: {
      projectId: pid,
      clientId: pid ? null : cid, // pozycja projektowa nie trzyma clientId (klient z projektu)
      label: label && label.trim() ? label.trim() : null,
      amount: Number(amount) || 0,
      vatRate: vatRate === undefined ? null : vatRate,
      date: date ? new Date(date) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      note: note && note.trim() ? note.trim() : null,
    },
  });
}

// Edycja pozycji + ewentualne przeniesienie między projektem a „bez projektu".
// fallbackClientId — klient, do którego trafia pozycja po wybraniu „bez projektu".
function update(id, { label, amount, vatRate, date, dueDate, projectId, paidAt }, fallbackClientId) {
  const pid = projectId ? Number(projectId) : null;
  const data = {
    label: label && label.trim() ? label.trim() : null,
    amount: Number(amount) || 0,
    projectId: pid,
    clientId: pid ? null : (fallbackClientId != null ? Number(fallbackClientId) : null),
  };
  if (vatRate !== undefined) data.vatRate = vatRate;
  if (date !== undefined) data.date = date ? new Date(date) : null;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (paidAt !== undefined) { // zmiana daty rozliczenia w edytorze pozycji (pusta → cofa rozliczenie)
    let p = null;
    if (paidAt) { const d = new Date(paidAt); if (!Number.isNaN(d.getTime())) { d.setHours(12, 0, 0, 0); p = d; } }
    data.paidAt = p;
  }
  return prisma.charge.update({ where: { id: Number(id) }, data });
}

function setPaid(id, paid) {
  return prisma.charge.update({ where: { id: Number(id) }, data: { paidAt: paid ? new Date() : null } });
}

// Ustawia konkretną datę rozliczenia (zmiana daty po oznaczeniu jako rozliczone).
// Pusta wartość → cofa rozliczenie. Godzina 12:00 unika przesunięć stref czasowych.
function setPaidDate(id, dateStr) {
  let paidAt = null;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) { d.setHours(12, 0, 0, 0); paidAt = d; }
  }
  return prisma.charge.update({ where: { id: Number(id) }, data: { paidAt } });
}

function remove(id) {
  return prisma.charge.delete({ where: { id: Number(id) } });
}

// Wszystkie pozycje klienta: przypięte wprost (clientId) + z jego projektów (poza usuniętymi).
function clientWhere(clientId) {
  const cid = Number(clientId);
  return { OR: [{ clientId: cid }, { project: { clientId: cid, status: { not: 'deleted' } } }] };
}

// Podsumowanie rozliczeń klienta (pozycje bezprojektowe + po jego projektach poza usuniętymi).
async function clientTotals(clientId) {
  const charges = await prisma.charge.findMany({
    where: clientWhere(clientId),
    select: { amount: true, vatRate: true, paidAt: true },
  });
  return totals(charges);
}

// Mapa clientId → kwota do rozliczenia (nierozliczone), dla listy klientów.
async function outstandingByClients(clientIds) {
  if (!clientIds || !clientIds.length) return {};
  const charges = await prisma.charge.findMany({
    where: {
      paidAt: null,
      OR: [
        { clientId: { in: clientIds } },
        { project: { clientId: { in: clientIds }, status: { not: 'deleted' } } },
      ],
    },
    select: { amount: true, vatRate: true, clientId: true, project: { select: { clientId: true } } },
  });
  const map = {};
  charges.forEach((c) => {
    const cid = c.clientId != null ? c.clientId : (c.project ? c.project.clientId : null);
    if (cid != null) map[cid] = (map[cid] || 0) + grossOf(c);
  });
  return map;
}

// Pozycje do wydruku rozliczenia klienta — filtr: zakres dat, status, zaznaczone id.
function forStatement(clientId, { from, to, status, ids } = {}) {
  const where = clientWhere(clientId);
  if (status === 'unpaid') where.paidAt = null;
  else if (status === 'paid') where.paidAt = { not: null };
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.date.lte = d; }
  }
  if (ids && ids.length) {
    const list = ids.map((x) => parseInt(x, 10)).filter(Number.isInteger);
    where.id = { in: list.length ? list : [-1] }; // pusty wybór = nic
  }
  return prisma.charge.findMany({
    where,
    include: { project: { select: { id: true, name: true } } },
    orderBy: [{ project: { name: 'asc' } }, { date: 'asc' }, { createdAt: 'asc' }],
  });
}

// Suma brutto pozycji spełniających warunek (findMany + grossOf — agregat SQL nie liczy VAT).
async function sumGross(where) {
  const rows = await prisma.charge.findMany({ where, select: { amount: true, vatRate: true } });
  return rows.reduce((s, c) => s + grossOf(c), 0);
}

// Łączna kwota do rozliczenia (pozycje bezprojektowe + projekty poza usuniętymi) — kafelek pulpitu.
function totalOutstanding() {
  return sumGross({
    paidAt: null,
    OR: [
      { projectId: null },                         // pozycje wprost na kliencie (bez projektu)
      { project: { status: { not: 'deleted' } } }, // pozycje projektów poza usuniętymi
    ],
  });
}

// Suma przeterminowanych należności (nierozliczone, dueDate < dziś) — kafelek pulpitu.
function overdueTotal() {
  return sumGross({
    paidAt: null,
    dueDate: { not: null, lt: new Date() },
    OR: [{ projectId: null }, { project: { status: { not: 'deleted' } } }],
  });
}

module.exports = { parseAmount, parseVatRate, VAT_RATES, vatOf, grossOf, totals, getById, getByIdWithProject, ownerClientId, directCount, listByProject, create, update, setPaid, setPaidDate, remove, clientTotals, outstandingByClients, totalOutstanding, overdueTotal, forStatement };
