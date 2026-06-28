// Rozliczenia — pozycje kwotowe projektu. Kwoty w GROSZACH (Int).
const prisma = require('../db/client');

// "1500,50" / "1 500.50" / "1500" → grosze (Int). Niepoprawne → 0.
function parseAmount(input) {
  if (input == null) return 0;
  const n = parseFloat(String(input).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

// Podsumowanie z tablicy pozycji: { total, paid, outstanding } (w groszach).
function totals(charges) {
  let total = 0;
  let paid = 0;
  (charges || []).forEach((c) => {
    total += c.amount;
    if (c.paidAt) paid += c.amount;
  });
  return { total, paid, outstanding: total - paid };
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
function create({ projectId, clientId, label, amount, note, date }) {
  const pid = projectId ? Number(projectId) : null;
  const cid = clientId ? Number(clientId) : null;
  return prisma.charge.create({
    data: {
      projectId: pid,
      clientId: pid ? null : cid, // pozycja projektowa nie trzyma clientId (klient z projektu)
      label: label && label.trim() ? label.trim() : null,
      amount: Number(amount) || 0,
      date: date ? new Date(date) : new Date(),
      note: note && note.trim() ? note.trim() : null,
    },
  });
}

// Edycja pozycji + ewentualne przeniesienie między projektem a „bez projektu".
// fallbackClientId — klient, do którego trafia pozycja po wybraniu „bez projektu".
function update(id, { label, amount, date, projectId }, fallbackClientId) {
  const pid = projectId ? Number(projectId) : null;
  const data = {
    label: label && label.trim() ? label.trim() : null,
    amount: Number(amount) || 0,
    projectId: pid,
    clientId: pid ? null : (fallbackClientId != null ? Number(fallbackClientId) : null),
  };
  if (date !== undefined) data.date = date ? new Date(date) : null;
  return prisma.charge.update({ where: { id: Number(id) }, data });
}

function setPaid(id, paid) {
  return prisma.charge.update({ where: { id: Number(id) }, data: { paidAt: paid ? new Date() : null } });
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
    select: { amount: true, paidAt: true },
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
    select: { amount: true, clientId: true, project: { select: { clientId: true } } },
  });
  const map = {};
  charges.forEach((c) => {
    const cid = c.clientId != null ? c.clientId : (c.project ? c.project.clientId : null);
    if (cid != null) map[cid] = (map[cid] || 0) + c.amount;
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

// Łączna kwota do rozliczenia (pozycje bezprojektowe + projekty poza usuniętymi) — kafelek pulpitu.
async function totalOutstanding() {
  const r = await prisma.charge.aggregate({
    _sum: { amount: true },
    where: {
      paidAt: null,
      OR: [
        { projectId: null },                         // pozycje wprost na kliencie (bez projektu)
        { project: { status: { not: 'deleted' } } }, // pozycje projektów poza usuniętymi
      ],
    },
  });
  return r._sum.amount || 0;
}

module.exports = { parseAmount, totals, getById, getByIdWithProject, ownerClientId, directCount, listByProject, create, update, setPaid, remove, clientTotals, outstandingByClients, totalOutstanding, forStatement };
