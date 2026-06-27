// Baza klientów — klient może mieć wiele projektów. Dostęp przez token (/c/:token).
const crypto = require('crypto');
const prisma = require('../db/client');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

const STATUSES = ['lead', 'active', 'inactive'];
const normStatus = (s) => (STATUSES.includes(s) ? s : 'active');

async function list({ q, status } = {}) {
  const where = {};
  if (q && q.trim()) {
    const s = q.trim();
    // wyszukiwanie po wszystkich polach tekstowych (SQLite LIKE — bez rozróżniania wielkości, ASCII)
    where.OR = [
      { name: { contains: s } },
      { email: { contains: s } },
      { company: { contains: s } },
      { phone: { contains: s } },
      { tags: { contains: s } },
      { note: { contains: s } },
    ];
  }
  if (STATUSES.includes(status)) where.status = status;
  const clients = await prisma.client.findMany({
    where,
    include: { _count: { select: { projects: true } } },
    orderBy: { name: 'asc' },
  });
  // Dolicz „do rozliczenia" (suma nierozliczonych pozycji po projektach klienta).
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    const charges = await prisma.charge.findMany({
      where: { paidAt: null, project: { clientId: { in: ids }, status: { not: 'deleted' } } },
      select: { amount: true, project: { select: { clientId: true } } },
    });
    const map = {};
    charges.forEach((c) => { const k = c.project.clientId; if (k != null) map[k] = (map[k] || 0) + c.amount; });
    clients.forEach((c) => { c.outstanding = map[c.id] || 0; });
  }
  return clients;
}

function getById(id) {
  return prisma.client.findUnique({
    where: { id: Number(id) },
    include: { projects: { orderBy: { updatedAt: 'desc' } } },
  });
}

// Dane do strony klienta 360°: klient + jego projekty (z licznikiem transferów),
// ostatnie transfery ze wszystkich jego projektów oraz oś czasu aktywności.
async function overview(id) {
  const cid = Number(id);
  const client = await prisma.client.findUnique({
    where: { id: cid },
    include: {
      projects: {
        include: { _count: { select: { transfers: true } } },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });
  if (!client) return null;
  const [transfers, events, charges] = await Promise.all([
    prisma.transfer.findMany({
      where: { project: { clientId: cid } },
      include: { files: true, project: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.event.findMany({
      // notatki (clientId bez projektu) + zdarzenia jego projektów (też historyczne, bez clientId)
      where: { OR: [{ clientId: cid }, { project: { clientId: cid } }] },
      include: { project: true, transfer: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.charge.findMany({
      where: { project: { clientId: cid, status: { not: 'deleted' } } },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);
  let total = 0;
  let paid = 0;
  charges.forEach((c) => { total += c.amount; if (c.paidAt) paid += c.amount; });
  const billing = { total, paid, outstanding: total - paid };
  return { client, transfers, events, billing, charges };
}

// Publiczny portal klienta — jego aktywne/zarchiwizowane projekty (bez usuniętych).
function getByToken(token) {
  return prisma.client.findUnique({
    where: { token },
    include: { projects: { where: { status: { not: 'deleted' } }, orderBy: { updatedAt: 'desc' } } },
  });
}

// Lista do dropdownów (przypisanie projektu).
function options() {
  return prisma.client.findMany({ orderBy: { name: 'asc' } });
}

// Chmurka najczęściej używanych tagów (do podpowiadania spójnych tagów w formularzu).
async function tagCloud(limit = 20) {
  const rows = await prisma.client.findMany({ where: { tags: { not: null } }, select: { tags: true } });
  const counts = {};
  rows.forEach((r) => {
    (r.tags || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

const clean = (v) => (v && v.trim() ? v.trim() : null);

function create({ name, email, note, company, phone, status, tags }) {
  return prisma.client.create({
    data: {
      name: name.trim(),
      email: clean(email),
      note: clean(note),
      company: clean(company),
      phone: clean(phone),
      status: normStatus(status),
      tags: clean(tags),
      token: makeToken(),
    },
  });
}

function update(id, { name, email, note, company, phone, status, tags }) {
  return prisma.client.update({
    where: { id: Number(id) },
    data: {
      name: name.trim(),
      email: clean(email),
      note: clean(note),
      company: clean(company),
      phone: clean(phone),
      status: normStatus(status),
      tags: clean(tags),
    },
  });
}

// Usuwa klienta. Projekty zostają, tracą tylko przypisanie (clientId → null).
async function remove(id) {
  await prisma.project.updateMany({ where: { clientId: Number(id) }, data: { clientId: null } });
  await prisma.event.updateMany({ where: { clientId: Number(id) }, data: { clientId: null } }); // zachowaj historię, odepnij od klienta
  return prisma.client.delete({ where: { id: Number(id) } });
}

module.exports = { list, getById, overview, getByToken, options, tagCloud, create, update, remove };
