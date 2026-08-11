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
async function createOutgoingTransfer({ title, message, password, expiresAt, maxDownloads, projectId, uploadedFiles, createdById, clientVisible = true, notifyOnDownload = false, proofing = false }) {
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
      proofing: !!proofing,
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
// client: e-mail klienta projektu podstawiany w polu „Wyślij link e-mailem".
function getById(id) {
  return prisma.transfer.findUnique({
    where: { id: Number(id) },
    include: { files: true, project: { include: { client: { select: { id: true, name: true, email: true } } } } },
  });
}

// Sortowanie listy transferów (whitelist — wartość wchodzi do orderBy).
// „size" liczymy w JS: suma File.size to BigInt, SQL-owe sortowanie po sumie relacji
// wymagałoby osobnego zapytania i tak trzymamy już wszystkie pliki w include.
const SORTS = ['created_desc', 'created_asc', 'expires_asc', 'expires_desc', 'downloads_desc', 'size_desc'];
const ORDER_BY = {
  created_desc: { createdAt: 'desc' },
  created_asc: { createdAt: 'asc' },
  // Transfery bez daty wygaśnięcia trafiają na koniec (SQLite: NULL jest „najmniejszy").
  expires_asc: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
  expires_desc: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
  downloads_desc: [{ downloadCount: 'desc' }, { createdAt: 'desc' }],
  size_desc: { createdAt: 'desc' },
};

function totalSize(t) {
  return (t.files || []).reduce((a, f) => a + BigInt(f.size), 0n);
}

// Lista transferów do panelu (opcjonalne filtry + sortowanie).
async function list({ direction, status, q, sort } = {}) {
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
  const key = SORTS.includes(sort) ? sort : 'created_desc';
  const transfers = await prisma.transfer.findMany({
    where,
    include: { files: true, project: true },
    orderBy: ORDER_BY[key],
  });
  if (key === 'expires_asc') {
    // NULL-e (bez wygaśnięcia) na koniec — inaczej przesłoniłyby najbliższe terminy.
    const withDate = transfers.filter((t) => t.expiresAt);
    const without = transfers.filter((t) => !t.expiresAt);
    return withDate.concat(without);
  }
  if (key === 'size_desc') return transfers.sort((a, b) => (totalSize(b) > totalSize(a) ? 1 : totalSize(b) < totalSize(a) ? -1 : 0));
  return transfers;
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
async function update(id, { title, message, expiresAt, maxDownloads, newPassword, removePassword, projectId, clientVisible, notifyOnDownload, proofing }) {
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
    proofing: proofing != null ? !!proofing : current.proofing,
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

// Usuwa POJEDYNCZY plik transferu (panel: edycja zawartości już utworzonego transferu).
// Kasuje plik z dysku ORAZ wiersz z bazy — `onDelete: Cascade` działa tylko w drugą stronę
// (kasowanie transferu kasuje pliki), samo usunięcie File nie rusza dysku. Wzorzec jak
// w document.service.remove(). Filtr po transferId chroni przed usunięciem cudzego pliku.
async function removeFile(transferId, fileId) {
  const file = await prisma.file.findFirst({ where: { id: Number(fileId), transferId: Number(transferId) } });
  if (!file) return null;
  storage.removeStored(file.storedPath);
  await prisma.file.delete({ where: { id: file.id } });
  return file;
}

// Czyści decyzję proofingu. Wołane, gdy admin zmieni ZAWARTOŚĆ transferu, który klient już
// zatwierdził/odesłał z uwagami — zestaw plików przestał być tym, który klient oceniał.
// Wzorzec jak przy edycji oferty (offer.service.update resetuje status i decyzję).
function resetApproval(id) {
  return prisma.transfer.update({
    where: { id: Number(id) },
    data: { approvalStatus: null, approvalComment: null, approvalBy: null, approvalAt: null },
  });
}

// Usuwa transfer i jego pliki z dysku.
async function remove(transfer) {
  storage.removeTransfer(transfer.token);
  await prisma.transfer.delete({ where: { id: transfer.id } });
}

// Proofing: decyzja klienta o dostarczonych plikach. decision: 'approved' | 'changes'
// (przy 'changes' komentarz wymagany). Nadpisuje poprzednią decyzję (klient może zmienić zdanie).
function setDecision(id, { decision, comment, name }) {
  if (!['approved', 'changes'].includes(decision)) return null;
  const c = (comment || '').trim().slice(0, 4000);
  if (decision === 'changes' && !c) return null;
  return prisma.transfer.update({
    where: { id: Number(id) },
    data: {
      approvalStatus: decision,
      approvalComment: c || null,
      approvalBy: ((name || '').trim().slice(0, 120)) || null,
      approvalAt: new Date(),
    },
  });
}

// Przedłuża ważność transferu (od teraz) i kasuje znacznik ostrzeżenia; reaktywuje wygasły.
function extend(id, days) {
  const d = Math.min(365, Math.max(1, parseInt(days, 10) || 14));
  const expiresAt = new Date(Date.now() + d * 86400000);
  return prisma.transfer.update({ where: { id: Number(id) }, data: { expiresAt, expiryWarnedAt: null, status: 'active' } });
}

module.exports = {
  SORTS,
  totalSize,
  extend,
  setDecision,
  createOutgoingTransfer,
  createUploadRequest,
  addFiles,
  removeFile,
  resetApproval,
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
