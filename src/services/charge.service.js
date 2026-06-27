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

function listByProject(projectId) {
  return prisma.charge.findMany({ where: { projectId: Number(projectId) }, orderBy: { createdAt: 'asc' } });
}

function create({ projectId, label, amount, note }) {
  return prisma.charge.create({
    data: {
      projectId: Number(projectId),
      label: label && label.trim() ? label.trim() : null,
      amount: Number(amount) || 0,
      note: note && note.trim() ? note.trim() : null,
    },
  });
}

function setPaid(id, paid) {
  return prisma.charge.update({ where: { id: Number(id) }, data: { paidAt: paid ? new Date() : null } });
}

function remove(id) {
  return prisma.charge.delete({ where: { id: Number(id) } });
}

// Podsumowanie rozliczeń klienta (po wszystkich jego projektach poza usuniętymi).
async function clientTotals(clientId) {
  const charges = await prisma.charge.findMany({
    where: { project: { clientId: Number(clientId), status: { not: 'deleted' } } },
    select: { amount: true, paidAt: true },
  });
  return totals(charges);
}

// Mapa clientId → kwota do rozliczenia (nierozliczone), dla listy klientów.
async function outstandingByClients(clientIds) {
  if (!clientIds || !clientIds.length) return {};
  const charges = await prisma.charge.findMany({
    where: { paidAt: null, project: { clientId: { in: clientIds }, status: { not: 'deleted' } } },
    select: { amount: true, project: { select: { clientId: true } } },
  });
  const map = {};
  charges.forEach((c) => {
    const cid = c.project.clientId;
    if (cid != null) map[cid] = (map[cid] || 0) + c.amount;
  });
  return map;
}

// Łączna kwota do rozliczenia (projekty poza usuniętymi) — kafelek pulpitu.
async function totalOutstanding() {
  const r = await prisma.charge.aggregate({
    _sum: { amount: true },
    where: { paidAt: null, project: { status: { not: 'deleted' } } },
  });
  return r._sum.amount || 0;
}

module.exports = { parseAmount, totals, getById, listByProject, create, setPaid, remove, clientTotals, outstandingByClients, totalOutstanding };
