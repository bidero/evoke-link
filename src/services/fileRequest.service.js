// Lista braków — checklist materiałów, o które prosimy klienta (per projekt).
const prisma = require('../db/client');

function listByProject(projectId) {
  return prisma.fileRequest.findMany({ where: { projectId: Number(projectId) }, orderBy: { id: 'asc' } });
}

function create(projectId, { label, note }) {
  const l = (label || '').trim().slice(0, 200);
  if (!l) return null;
  return prisma.fileRequest.create({ data: { projectId: Number(projectId), label: l, note: ((note || '').trim().slice(0, 500)) || null } });
}

// Ręczne przełączenie przez agencję (odhacz / cofnij).
async function toggle(id, projectId) {
  const r = await prisma.fileRequest.findUnique({ where: { id: Number(id) } });
  if (!r || r.projectId !== Number(projectId)) return null;
  return prisma.fileRequest.update({ where: { id: r.id }, data: { done: !r.done, doneAt: r.done ? null : new Date(), transferId: r.done ? null : r.transferId } });
}

function remove(id, projectId) {
  return prisma.fileRequest.deleteMany({ where: { id: Number(id), projectId: Number(projectId) } });
}

// Domknięcie punktu przez upload klienta (select przy przesyłaniu plików).
// Zwraca punkt (do treści zdarzenia) albo null, gdy nie należy do projektu / już odhaczony.
async function fulfill(id, projectId, transferId) {
  const r = await prisma.fileRequest.findUnique({ where: { id: Number(id) } });
  if (!r || r.projectId !== Number(projectId) || r.done) return null;
  return prisma.fileRequest.update({ where: { id: r.id }, data: { done: true, doneAt: new Date(), transferId: Number(transferId) || null } });
}

module.exports = { listByProject, create, toggle, remove, fulfill };
