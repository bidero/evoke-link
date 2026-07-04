// Dokumenty klienta (umowy, NDA, briefy) — pliki w storage/transfers/_documents/,
// opcjonalnie widoczne dla klienta w portalu /c (visibleToClient).
const prisma = require('../db/client');
const storage = require('./storage.service');

const clean = (v) => { const s = (v == null ? '' : String(v)).trim(); return s || null; };

function list(clientId) {
  return prisma.document.findMany({ where: { clientId: Number(clientId) }, orderBy: { createdAt: 'desc' } });
}
function listVisible(clientId) {
  return prisma.document.findMany({ where: { clientId: Number(clientId), visibleToClient: true }, orderBy: { createdAt: 'desc' } });
}
function getById(id) {
  return prisma.document.findUnique({ where: { id: Number(id) } });
}

// Zapis dokumentu z multer req.file. Zwraca dokument albo null (brak pliku).
function create(clientId, { file, label, visibleToClient }) {
  if (!file) return null;
  const stored = storage.saveDocumentFile(file.path, storage.makeStoredName(file.originalname));
  return prisma.document.create({
    data: {
      clientId: Number(clientId),
      storedPath: stored,
      name: (file.originalname || 'dokument').slice(0, 255),
      label: clean(label),
      size: file.size,
      mime: file.mimetype,
      visibleToClient: !!visibleToClient,
    },
  });
}

async function toggleVisible(id) {
  const d = await getById(id);
  if (!d) return null;
  return prisma.document.update({ where: { id: d.id }, data: { visibleToClient: !d.visibleToClient } });
}

async function remove(id) {
  const d = await getById(id);
  if (!d) return null;
  storage.removeStored(d.storedPath); // usuń plik z dysku
  return prisma.document.delete({ where: { id: d.id } });
}

module.exports = { list, listVisible, getById, create, toggleVisible, remove };
