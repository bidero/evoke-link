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

// Skrzynka w panelu — najnowsze wiadomości z kontekstem (klient/projekt/transfer).
function listInbox(limit = 200) {
  return prisma.message.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      transfer: { select: { id: true, title: true, token: true } },
    },
  });
}

// Liczba nieprzeczytanych (plakietka w menu „Wiadomości").
function unreadCount() {
  return prisma.message.count({ where: { isRead: false } });
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

module.exports = { create, listInbox, unreadCount, markRead, markAllRead, remove };
