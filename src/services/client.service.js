// Baza klientów — klient może mieć wiele projektów. Dostęp przez token (/c/:token).
const crypto = require('crypto');
const prisma = require('../db/client');
const chargeService = require('./charge.service');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

const STATUSES = ['lead', 'active', 'inactive'];
const normStatus = (s) => (STATUSES.includes(s) ? s : 'active');

// Sortowanie po polsku (ą, ć, ł… we właściwych miejscach, bez rozróżniania wielkości).
// SQLite ORDER BY używa kolacji BINARY — porządkuje po ASCII, więc sortujemy w JS.
const byNamePl = (a, b) => (a.name || '').localeCompare(b.name || '', 'pl', { sensitivity: 'base' });

// Sortowanie listy klientów: pole (nazwa/firma/nazwisko) × kierunek (rosnąco/malejąco).
// Puste wartości zawsze na końcu; remis rozstrzyga nazwa wyświetlana.
const SORT_FIELDS = { name: 'name', company: 'company', lastname: 'lastName' };
const SORTS = ['name_asc', 'name_desc', 'company_asc', 'company_desc', 'lastname_asc', 'lastname_desc'];
function sortClients(clients, sort) {
  const [f, dir] = String(SORTS.includes(sort) ? sort : 'name_asc').split('_');
  const field = SORT_FIELDS[f] || 'name';
  const mul = dir === 'desc' ? -1 : 1;
  return clients.sort((a, b) => {
    const av = (a[field] || '').trim();
    const bv = (b[field] || '').trim();
    if (!av && !bv) return byNamePl(a, b);
    if (!av) return 1;   // puste na końcu, niezależnie od kierunku
    if (!bv) return -1;
    const cmp = av.localeCompare(bv, 'pl', { sensitivity: 'base' }) || byNamePl(a, b);
    return cmp * mul;
  });
}

async function list({ q, status, sort } = {}) {
  const where = {};
  if (q && q.trim()) {
    const s = q.trim();
    // wyszukiwanie po wszystkich polach tekstowych (SQLite LIKE — bez rozróżniania wielkości, ASCII)
    where.OR = [
      { name: { contains: s } },
      { firstName: { contains: s } },
      { lastName: { contains: s } },
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
  // Dolicz „do rozliczenia" (nierozliczone pozycje: po projektach klienta + przypięte wprost).
  const ids = clients.map((c) => c.id);
  if (ids.length) {
    const charges = await prisma.charge.findMany({
      where: {
        paidAt: null,
        OR: [
          { clientId: { in: ids } },
          { project: { clientId: { in: ids }, status: { not: 'deleted' } } },
        ],
      },
      select: { amount: true, vatRate: true, clientId: true, project: { select: { clientId: true } } },
    });
    const map = {};
    charges.forEach((c) => { const k = c.clientId != null ? c.clientId : (c.project ? c.project.clientId : null); if (k != null) map[k] = (map[k] || 0) + chargeService.grossOf(c); });
    clients.forEach((c) => { c.outstanding = map[c.id] || 0; });
  }
  return sortClients(clients, sort);
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
      take: 50, // zakładka „Transfery" pokazuje pełną listę; „Przegląd" bierze pierwsze 3
    }),
    prisma.event.findMany({
      // notatki (clientId bez projektu) + zdarzenia jego projektów (też historyczne, bez clientId)
      where: { OR: [{ clientId: cid }, { project: { clientId: cid } }] },
      include: { project: true, transfer: true },
      orderBy: { createdAt: 'desc' },
      take: 50, // zakładka „Oś czasu" pełna; „Przegląd" bierze pierwsze 3
    }),
    prisma.charge.findMany({
      // pozycje przypięte wprost (clientId) + z projektów klienta (poza usuniętymi)
      where: { OR: [{ clientId: cid }, { project: { clientId: cid, status: { not: 'deleted' } } }] },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);
  const billing = chargeService.totals(charges);
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
async function options() {
  const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
  return clients.sort(byNamePl);
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

function create({ name, firstName, lastName, email, note, company, phone, nip, address, status, tags }) {
  return prisma.client.create({
    data: {
      name: name.trim(),
      firstName: clean(firstName),
      lastName: clean(lastName),
      email: clean(email),
      note: clean(note),
      company: clean(company),
      phone: clean(phone),
      nip: clean(nip),
      address: clean(address),
      status: normStatus(status),
      tags: clean(tags),
      token: makeToken(),
    },
  });
}

function update(id, { name, firstName, lastName, email, note, company, phone, nip, address, status, tags }) {
  return prisma.client.update({
    where: { id: Number(id) },
    data: {
      name: name.trim(),
      firstName: clean(firstName),
      lastName: clean(lastName),
      email: clean(email),
      note: clean(note),
      company: clean(company),
      phone: clean(phone),
      nip: clean(nip),
      address: clean(address),
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

module.exports = { list, getById, overview, getByToken, options, tagCloud, create, update, remove, SORTS };
