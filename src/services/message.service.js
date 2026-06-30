// Wiadomości od klientów (Faza A: jednokierunkowo klient → agencja).
// Przypięte do kontekstu wysyłki: projekt (/p), transfer (/t) lub klient (/c).
const prisma = require('../db/client');

const MAX = 4000; // twardy limit długości treści
const clean = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };

// Tworzy wiadomość. Zwraca null, gdy treść pusta (po trim).
async function create({ body, senderName, senderEmail, clientId, projectId, transferId, ip }) {
  const text = (body == null ? '' : String(body)).trim().slice(0, MAX);
  if (!text) return null;
  return prisma.message.create({
    data: {
      body: text,
      senderName: clean(senderName),
      senderEmail: clean(senderEmail),
      clientId: clientId || null,
      projectId: projectId || null,
      transferId: transferId || null,
      ip: ip || null,
    },
  });
}

// Skrzynka w panelu — wiadomości OD klientów (direction 'in'), z kontekstem.
function listInbox(limit = 200) {
  return prisma.message.findMany({
    where: { direction: 'in' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      transfer: { select: { id: true, title: true, token: true } },
    },
  });
}

// Liczba nieprzeczytanych wiadomości OD klientów (plakietka w menu „Wiadomości").
function unreadCount() {
  return prisma.message.count({ where: { direction: 'in', isRead: false } });
}

// Pojedyncza wiadomość z kontekstem — do odpowiedzi (e-mail klienta + link zwrotny).
function getById(id) {
  return prisma.message.findUnique({
    where: { id: Number(id) },
    include: {
      client: { select: { id: true, name: true, email: true, token: true } },
      project: { select: { id: true, name: true, clientToken: true } },
      transfer: { select: { id: true, title: true, token: true } },
    },
  });
}

// Wątek (rozmowa) dla kontekstu — chronologicznie; klient widzi go w popupie (in + out).
function thread(scope, limit = 50) {
  let where;
  if (scope.transferId) where = { transferId: Number(scope.transferId) };
  else if (scope.projectId) where = { projectId: Number(scope.projectId) };
  else if (scope.clientId) where = { clientId: Number(scope.clientId), projectId: null, transferId: null };
  else return Promise.resolve([]);
  return prisma.message.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit });
}

// Odpowiedź agencji — nowa wiadomość direction 'out' w tym samym kontekście co oryginał.
async function reply({ original, body }) {
  const text = (body == null ? '' : String(body)).trim().slice(0, MAX);
  if (!text) return null;
  return prisma.message.create({
    data: {
      body: text,
      direction: 'out',
      clientId: original.clientId || null,
      projectId: original.projectId || null,
      transferId: original.transferId || null,
    },
  });
}

// updateMany/deleteMany — nie rzucają, gdy id nie istnieje.
function markRead(id) {
  return prisma.message.updateMany({ where: { id: Number(id) }, data: { isRead: true } });
}
function markAllRead() {
  return prisma.message.updateMany({ where: { isRead: false }, data: { isRead: true } });
}
function remove(id) {
  return prisma.message.deleteMany({ where: { id: Number(id) } });
}

module.exports = { create, listInbox, unreadCount, getById, thread, reply, markRead, markAllRead, remove };
