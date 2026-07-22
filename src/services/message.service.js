// Wiadomości od klientów (Faza A: jednokierunkowo klient → agencja).
// Przypięte do kontekstu wysyłki: projekt (/p), transfer (/t) lub klient (/c).
const prisma = require('../db/client');
const storage = require('./storage.service');

const MAX = 4000; // twardy limit długości treści
const clean = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };

// Tworzy wiadomość. Zwraca null, gdy treść pusta (po trim). `file` = multer req.file (opcjonalny załącznik).
async function create({ body, senderName, senderEmail, clientId, projectId, transferId, ip, file }) {
  const text = (body == null ? '' : String(body)).trim().slice(0, MAX);
  if (!text) { if (file) storage.removeTmp(file.path); return null; } // pusta treść → nie trzymaj osieroconego pliku

  let att = {};
  if (file) {
    const stored = storage.saveMessageFile(file.path, storage.makeStoredName(file.originalname));
    att = { attachmentPath: stored, attachmentName: (file.originalname || 'plik').slice(0, 255), attachmentSize: file.size, attachmentMime: file.mimetype };
  }
  return prisma.message.create({
    data: {
      body: text,
      senderName: clean(senderName),
      senderEmail: clean(senderEmail),
      clientId: clientId || null,
      projectId: projectId || null,
      transferId: transferId || null,
      ip: ip || null,
      ...att,
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

// Wątki do panelu — wszystkie wiadomości pogrupowane po kontekście (rozmowy), najnowsze u góry.
async function listThreads(limit = 100) {
  const all = await prisma.message.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      transfer: { select: { id: true, title: true, token: true } },
    },
  });
  const map = new Map();
  for (const m of all) {
    const key = m.transferId ? 't' + m.transferId : (m.projectId ? 'p' + m.projectId : (m.clientId ? 'c' + m.clientId : 'm' + m.id));
    let t = map.get(key);
    if (!t) { t = { key, messages: [], client: null, project: null, transfer: null, unread: 0, lastAt: m.createdAt, lastId: m.id }; map.set(key, t); }
    t.messages.push(m);
    if (m.direction === 'in' && !m.isRead) t.unread += 1;
    if (m.client) t.client = m.client;
    if (m.project) t.project = m.project;
    if (m.transfer) t.transfer = m.transfer;
    t.lastAt = m.createdAt; // asc → ostatni wpis = najnowszy
    t.lastId = m.id;
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)).slice(0, limit);
}

// Zakres „wątku" (kontekstu) z dowolnej wiadomości — do oznaczania/kasowania całej rozmowy.
function scopeOf(m) {
  if (m.transferId) return { transferId: m.transferId };
  if (m.projectId) return { projectId: m.projectId };
  if (m.clientId) return { clientId: m.clientId, projectId: null, transferId: null };
  return { id: m.id };
}
function markThreadRead(m) {
  return prisma.message.updateMany({ where: { ...scopeOf(m), direction: 'in' }, data: { isRead: true } });
}
async function deleteThread(m) {
  const scope = scopeOf(m);
  // Usuń pliki załączników z dysku przed skasowaniem wierszy.
  const withFiles = await prisma.message.findMany({ where: { ...scope, attachmentPath: { not: null } }, select: { attachmentPath: true } });
  withFiles.forEach((r) => storage.removeStored(r.attachmentPath));
  return prisma.message.deleteMany({ where: scope });
}

// Załącznik wiadomości do pobrania (panel) — zwraca { path, name, mime } lub null.
async function attachment(id) {
  const m = await prisma.message.findUnique({ where: { id: Number(id) }, select: { attachmentPath: true, attachmentName: true, attachmentMime: true } });
  return m && m.attachmentPath ? { path: m.attachmentPath, name: m.attachmentName || 'zalacznik', mime: m.attachmentMime || 'application/octet-stream' } : null;
}

// Czy w wątku jest odpowiedź agencji (out) nowsza niż ostatnio „obejrzane" przez klienta (ts).
function hasUnseen(thread, lastSeen) {
  const ts = Number(lastSeen) || 0;
  return (thread || []).some((m) => m.direction === 'out' && new Date(m.createdAt).getTime() > ts);
}

// ── Komunikator agencji (dwupanel: lista klientów ↔ jeden strumień) ─────────────────────────────
// Wszystkie wiadomości agregujemy PER KLIENT (każda ścieżka tworzenia ustawia clientId; wiadomości
// bez klienta — transfer bez projektu — trafiają do kubełka „none").

// Lista rozmów: jeden wpis na klienta mającego wiadomości. Sort po najnowszej. unread = in && !isRead.
async function conversationList(limit = 300) {
  const all = await prisma.message.findMany({
    orderBy: { createdAt: 'asc' },
    include: { client: { select: { id: true, name: true } } },
  });
  const map = new Map();
  for (const m of all) {
    const key = m.clientId ? 'c' + m.clientId : 'none';
    let c = map.get(key);
    if (!c) { c = { key, clientId: m.clientId || null, client: m.client || null, lastAt: m.createdAt, lastBody: '', lastDir: 'in', unread: 0 }; map.set(key, c); }
    c.lastAt = m.createdAt; c.lastBody = m.body; c.lastDir = m.direction; // asc → ostatnia iteracja = najnowsza
    if (m.client) c.client = m.client;
    if (m.direction === 'in' && !m.isRead) c.unread += 1;
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)).slice(0, limit);
}

// Strumień jednej rozmowy (wszystkie wiadomości klienta, chronologicznie) + kontekst do chipów.
// clientId falsy → kubełek „Bez klienta" (clientId null).
function conversation(clientId, limit = 300) {
  const where = clientId ? { clientId: Number(clientId) } : { clientId: null };
  return prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { project: { select: { id: true, name: true, clientToken: true } }, transfer: { select: { id: true, title: true } } },
  });
}

// Agencja WYSYŁA (odpowiedź lub ZAGAJENIE) — direction 'out' w wybranym kontekście (scope).
// scope: { projectId } | { transferId } | {} (ogólne/kliencki). clientId zawsze ustawiany.
async function send({ clientId, projectId, transferId, body }) {
  const text = (body == null ? '' : String(body)).trim().slice(0, MAX);
  if (!text || !clientId) return null;
  return prisma.message.create({
    data: { body: text, direction: 'out', clientId: Number(clientId), projectId: projectId ? Number(projectId) : null, transferId: transferId ? Number(transferId) : null },
  });
}

// Trwałe oznaczenie przeczytania: wszystkie przychodzące (in) danego klienta → isRead.
function markClientRead(clientId) {
  return prisma.message.updateMany({ where: { clientId: Number(clientId), direction: 'in', isRead: false }, data: { isRead: true } });
}

// Usuń całą rozmowę klienta (z załącznikami z dysku).
async function deleteClientConversation(clientId) {
  const scope = clientId ? { clientId: Number(clientId) } : { clientId: null };
  const withFiles = await prisma.message.findMany({ where: { ...scope, attachmentPath: { not: null } }, select: { attachmentPath: true } });
  withFiles.forEach((r) => storage.removeStored(r.attachmentPath));
  return prisma.message.deleteMany({ where: scope });
}

module.exports = { create, listInbox, listThreads, unreadCount, getById, thread, reply, markThreadRead, deleteThread, attachment, hasUnseen, markRead, markAllRead, remove, conversationList, conversation, send, markClientRead, deleteClientConversation };
