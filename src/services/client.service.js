// Baza klientów — klient może mieć wiele projektów. Dostęp przez token (/c/:token).
const crypto = require('crypto');
const prisma = require('../db/client');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

const STATUSES = ['lead', 'active', 'inactive'];
const normStatus = (s) => (STATUSES.includes(s) ? s : 'active');

function list({ q, status } = {}) {
  const where = {};
  if (q && q.trim()) {
    const s = q.trim();
    where.OR = [{ name: { contains: s } }, { email: { contains: s } }, { company: { contains: s } }]; // SQLite LIKE — bez rozróżniania wielkości (ASCII)
  }
  if (STATUSES.includes(status)) where.status = status;
  return prisma.client.findMany({
    where,
    include: { _count: { select: { projects: true } } },
    orderBy: { name: 'asc' },
  });
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
  const [transfers, events] = await Promise.all([
    prisma.transfer.findMany({
      where: { project: { clientId: cid } },
      include: { files: true, project: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.event.findMany({
      where: { project: { clientId: cid } },
      include: { project: true, transfer: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);
  return { client, transfers, events };
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
  return prisma.client.delete({ where: { id: Number(id) } });
}

module.exports = { list, getById, overview, getByToken, options, create, update, remove };
