// Baza klientów — klient może mieć wiele projektów. Dostęp przez token (/c/:token).
const crypto = require('crypto');
const prisma = require('../db/client');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}

function list() {
  return prisma.client.findMany({
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

function create({ name, email, note }) {
  return prisma.client.create({
    data: {
      name: name.trim(),
      email: email && email.trim() ? email.trim() : null,
      note: note && note.trim() ? note.trim() : null,
      token: makeToken(),
    },
  });
}

function update(id, { name, email, note }) {
  return prisma.client.update({
    where: { id: Number(id) },
    data: {
      name: name.trim(),
      email: email && email.trim() ? email.trim() : null,
      note: note && note.trim() ? note.trim() : null,
    },
  });
}

// Usuwa klienta. Projekty zostają, tracą tylko przypisanie (clientId → null).
async function remove(id) {
  await prisma.project.updateMany({ where: { clientId: Number(id) }, data: { clientId: null } });
  return prisma.client.delete({ where: { id: Number(id) } });
}

module.exports = { list, getById, getByToken, options, create, update, remove };
