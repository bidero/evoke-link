// Logika biznesowa transferów wychodzących (agencja → klient).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const storage = require('./storage.service');

// Krótki, URL-bezpieczny token do publicznego linku, np. /t/Ab3xK9_q2Lm0
function makeToken() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 znaków
}

// Przenosi pliki z multera (tmp) do katalogu transferu i buduje dane do zapisu.
function buildFilesData(token, uploadedFiles) {
  return uploadedFiles.map((f) => {
    const storedName = storage.makeStoredName(f.originalname);
    const storedPath = storage.moveToTransfer(f.path, token, storedName);
    return {
      originalName: f.originalname,
      storedName,
      storedPath,
      size: BigInt(f.size || 0),
      mimeType: f.mimetype || null,
    };
  });
}

// Tworzy transfer wraz z plikami. `uploadedFiles` to tablica z multera
// (każdy ma: originalname, path (w tmp), size, mimetype).
async function createOutgoingTransfer({ title, message, password, expiresAt, maxDownloads, projectId, uploadedFiles, createdById, clientVisible = true, notifyOnDownload = false }) {
  const token = makeToken();
  const filesData = buildFilesData(token, uploadedFiles);

  const transfer = await prisma.transfer.create({
    data: {
      token,
      direction: 'outgoing',
      title: title || null,
      message: message || null,
      passwordHash: password ? bcrypt.hashSync(password, 10) : null,
      expiresAt: expiresAt || null,
      maxDownloads: maxDownloads || null,
      projectId: projectId || null,
      createdById: createdById || null,
      clientVisible: !!clientVisible,
      notifyOnDownload: !!notifyOnDownload,
      files: { create: filesData },
    },
    include: { files: true },
  });

  return transfer;
}

// Pobiera transfer po publicznym tokenie wraz z plikami i projektem.
function getByToken(token) {
  return prisma.transfer.findUnique({
    where: { token },
    include: { files: true, project: true },
  });
}

// Pobiera transfer po id (panel) wraz z plikami i projektem.
function getById(id) {
  return prisma.transfer.findUnique({
    where: { id: Number(id) },
    include: { files: true, project: true },
  });
}

// Lista transferów do panelu (z opcjonalnym filtrem).
function list({ direction, status, q } = {}) {
  const where = {};
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (q && q.trim()) {
    const s = q.trim();
    where.OR = [
      { title: { contains: s } },
      { token: { contains: s } },
      { files: { some: { originalName: { contains: s } } } }, // wyszukiwanie po nazwie pliku
    ];
  }
  return prisma.transfer.findMany({
    where,
    include: { files: true, project: true },
    orderBy: { createdAt: 'desc' },
  });
}

// Sprawdza, czy transfer jest dostępny do pobrania.
// Zwraca { ok, reason } — reason: 'not_found' | 'expired' | 'limit' | 'deleted'
function checkAvailability(transfer) {
  if (!transfer || transfer.status === 'deleted') return { ok: false, reason: 'not_found' };
  if (transfer.status === 'expired') return { ok: false, reason: 'expired' };
  if (transfer.expiresAt && new Date(transfer.expiresAt) < new Date()) return { ok: false, reason: 'expired' };
  if (transfer.maxDownloads != null && transfer.downloadCount >= transfer.maxDownloads) {
    return { ok: false, reason: 'limit' };
  }
  return { ok: true };
}

function requiresPassword(transfer) {
  return Boolean(transfer && transfer.passwordHash);
}

function verifyPassword(transfer, password) {
  if (!transfer.passwordHash) return true;
  return bcrypt.compareSync(password || '', transfer.passwordHash);
}

// Zwiększa licznik pobrań (po faktycznym wydaniu pliku/ZIP-a).
async function incrementDownload(transferId) {
  await prisma.transfer.update({
    where: { id: transferId },
    data: { downloadCount: { increment: 1 } },
  });
}

// Przelicza status na podstawie reguł (wygaśnięcie / limit). Nie rusza 'deleted'.
function recomputeStatus(transfer) {
  if (transfer.status === 'deleted') return 'deleted';
  if (transfer.expiresAt && new Date(transfer.expiresAt) < new Date()) return 'expired';
  if (transfer.maxDownloads != null && transfer.downloadCount >= transfer.maxDownloads) return 'expired';
  return 'active';
}

// Edycja transferu w panelu. Hasło: newPassword ustawia nowe, removePassword czyści,
// brak obu = bez zmian. Po edycji status jest przeliczany (np. wydłużenie ważności
// reaktywuje wygasły transfer).
async function update(id, { title, message, expiresAt, maxDownloads, newPassword, removePassword, projectId, clientVisible, notifyOnDownload }) {
  const current = await prisma.transfer.findUnique({ where: { id: Number(id) } });
  if (!current) return null;

  const data = {
    title: title && title.trim() ? title.trim() : null,
    message: message && message.trim() ? message.trim() : null,
    expiresAt: expiresAt || null,
    maxDownloads: maxDownloads != null ? maxDownloads : null,
    projectId: projectId != null ? projectId : null,
    clientVisible: clientVisible != null ? !!clientVisible : current.clientVisible,
    notifyOnDownload: notifyOnDownload != null ? !!notifyOnDownload : current.notifyOnDownload,
  };
  if (removePassword) data.passwordHash = null;
  else if (newPassword) data.passwordHash = bcrypt.hashSync(newPassword, 10);

  data.status = recomputeStatus({ ...current, ...data });

  return prisma.transfer.update({ where: { id: Number(id) }, data, include: { files: true } });
}

// Tworzy "link uploadu" (transfer przychodzący, klient → agencja) — bez plików na start.
async function createUploadRequest({ title, message, password, expiresAt, projectId, clientVisible = false }) {
  const token = makeToken();
  return prisma.transfer.create({
    data: {
      token,
      direction: 'incoming',
      title: title || null,
      message: message || null,
      passwordHash: password ? bcrypt.hashSync(password, 10) : null,
      expiresAt: expiresAt || null,
      projectId: projectId || null,
      clientVisible: !!clientVisible,
    },
    include: { files: true },
  });
}

// Dopisuje wgrane pliki do istniejącego transferu (używane przy uploadzie od klienta).
async function addFiles(transfer, uploadedFiles) {
  const filesData = buildFilesData(transfer.token, uploadedFiles);
  await prisma.transfer.update({
    where: { id: transfer.id },
    data: { files: { create: filesData } },
  });
  return prisma.transfer.findUnique({ where: { id: transfer.id }, include: { files: true } });
}

// Usuwa transfer i jego pliki z dysku.
async function remove(transfer) {
  storage.removeTransfer(transfer.token);
  await prisma.transfer.delete({ where: { id: transfer.id } });
}

module.exports = {
  createOutgoingTransfer,
  createUploadRequest,
  addFiles,
  update,
  getByToken,
  getById,
  list,
  checkAvailability,
  recomputeStatus,
  requiresPassword,
  verifyPassword,
  incrementDownload,
  remove,
};
