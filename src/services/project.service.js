// Logika projektów — pojemników grupujących transfery, pliki i historię.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const events = require('./event.service');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

// Tryby sortowania listy projektów. 'manual' = ręczna kolejność (drag & drop).
const SORTS = {
  activity: [{ updatedAt: 'desc' }],
  created: [{ createdAt: 'desc' }],
  name: [{ name: 'asc' }],
  manual: [{ position: 'asc' }, { updatedAt: 'desc' }],
};

// Lista projektów z licznikami transferów (do widoku listy i dropdownów).
async function list({ status, q, sort } = {}) {
  const where = {};
  if (status) where.status = status;
  if (q && q.trim()) {
    const s = q.trim();
    where.OR = [
      { name: { contains: s } },
      { clientName: { contains: s } },
      { client: { name: { contains: s } } }, // przypisany klient z bazy
    ];
  }
  const projects = await prisma.project.findMany({
    where,
    include: { _count: { select: { transfers: true } }, client: { select: { name: true } } },
    orderBy: SORTS[sort] || SORTS.activity,
  });
  // Liczba nieprzeczytanych powiadomień per projekt (badge „zaktualizowano").
  if (projects.length) {
    const grouped = await prisma.event.groupBy({
      by: ['projectId'],
      where: { isRead: false, dismissed: false, type: { in: events.NOTIFY_TYPES }, projectId: { in: projects.map((p) => p.id) } },
      _count: { _all: true },
    });
    const map = {};
    grouped.forEach((g) => { map[g.projectId] = g._count._all; });
    projects.forEach((p) => { p.unread = map[p.id] || 0; });
  }
  return projects;
}

// Projekt ze wszystkimi transferami (i ich plikami).
function getById(id) {
  return prisma.project.findUnique({
    where: { id: Number(id) },
    include: {
      client: true,
      transfers: { include: { files: true }, orderBy: { createdAt: 'desc' } },
      charges: { orderBy: { createdAt: 'asc' } },
    },
  });
}

// Historia projektu — zdarzenia powiązane z projektem (najnowsze na górze).
function getHistory(projectId, limit = 100) {
  return prisma.event.findMany({
    where: { projectId: Number(projectId) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

function create({ name, clientName, description, clientId }) {
  return prisma.project.create({
    data: {
      name: name.trim(),
      clientName: clientName && clientName.trim() ? clientName.trim() : null,
      description: description && description.trim() ? description.trim() : null,
      clientId: clientId || null,
      clientToken: makeToken(), // od razu nadajemy link do panelu klienta
    },
  });
}

async function update(id, { name, clientName, description, status, clientId, newClientPassword, removeClientPassword }) {
  const data = {
    name: name.trim(),
    clientName: clientName && clientName.trim() ? clientName.trim() : null,
    description: description && description.trim() ? description.trim() : null,
    clientId: clientId != null ? clientId : null,
  };
  if (status) data.status = status;
  if (removeClientPassword) data.clientPasswordHash = null;
  else if (newClientPassword) data.clientPasswordHash = bcrypt.hashSync(newClientPassword, 10);
  return prisma.project.update({ where: { id: Number(id) }, data });
}

// Panel klienta po publicznym tokenie (z transferami i plikami).
function getByClientToken(token) {
  return prisma.project.findUnique({
    where: { clientToken: token },
    include: { transfers: { include: { files: true }, orderBy: { createdAt: 'desc' } } },
  });
}

// Zapisuje ręczną kolejność: position = indeks na liście przekazanych id.
async function reorder(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  if (!list.length) return;
  await prisma.$transaction(list.map((id, idx) => prisma.project.update({ where: { id }, data: { position: idx } })));
}

// Dla starszych projektów bez tokenu — dogeneruj przy pierwszym wejściu na stronę projektu.
async function ensureClientToken(project) {
  if (project.clientToken) return project;
  return prisma.project.update({ where: { id: project.id }, data: { clientToken: makeToken() } });
}

function requiresClientPassword(project) {
  return Boolean(project && project.clientPasswordHash);
}

function verifyClientPassword(project, password) {
  if (!project.clientPasswordHash) return true;
  return bcrypt.compareSync(password || '', project.clientPasswordHash);
}

// Usuwa projekt. Transfery zostają (projectId → null wg schematu onDelete: SetNull),
// historia projektu znika (Event onDelete: Cascade).
function remove(id) {
  return prisma.project.delete({ where: { id: Number(id) } });
}

module.exports = {
  list,
  reorder,
  getById,
  getHistory,
  create,
  update,
  remove,
  getByClientToken,
  ensureClientToken,
  requiresClientPassword,
  verifyClientPassword,
};
