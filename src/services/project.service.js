// Logika projektów — pojemników grupujących transfery, pliki i historię.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

// Lista projektów z licznikami transferów (do widoku listy i dropdownów).
function list({ status } = {}) {
  const where = {};
  if (status) where.status = status;
  return prisma.project.findMany({
    where,
    include: { _count: { select: { transfers: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

// Projekt ze wszystkimi transferami (i ich plikami).
function getById(id) {
  return prisma.project.findUnique({
    where: { id: Number(id) },
    include: {
      transfers: { include: { files: true }, orderBy: { createdAt: 'desc' } },
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

function create({ name, clientName, description }) {
  return prisma.project.create({
    data: {
      name: name.trim(),
      clientName: clientName && clientName.trim() ? clientName.trim() : null,
      description: description && description.trim() ? description.trim() : null,
      clientToken: makeToken(), // od razu nadajemy link do panelu klienta
    },
  });
}

async function update(id, { name, clientName, description, status, newClientPassword, removeClientPassword }) {
  const data = {
    name: name.trim(),
    clientName: clientName && clientName.trim() ? clientName.trim() : null,
    description: description && description.trim() ? description.trim() : null,
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
