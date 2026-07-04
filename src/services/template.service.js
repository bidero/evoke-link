// Szablony projektów — powtarzalne projekty startują z gotową listą braków (FileRequest)
// i przypomnieniami (Reminder, termin = utworzenie projektu + offsetDays).
// Definicja wpisywana tekstem (linia = pozycja), parsowana tutaj — zero JS w formularzu.
const prisma = require('../db/client');
const reminderService = require('./reminder.service');

const clean = (v) => (v && v.trim() ? v.trim() : null);

function list() {
  return prisma.projectTemplate.findMany({ orderBy: { name: 'asc' } });
}

function getById(id) {
  return prisma.projectTemplate.findUnique({ where: { id: Number(id) } });
}

// „Lista braków": linia = `Etykieta` lub `Etykieta | notatka`.
function parseFileRequests(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    const [label, note] = line.split('|').map((s) => (s || '').trim());
    return label ? { label: label.slice(0, 200), ...(note ? { note: note.slice(0, 500) } : {}) } : null;
  }).filter(Boolean);
}

// „Przypomnienia": linia = `Tytuł | +dni | priorytet` (dni domyślnie 1; priorytet low|normal|high).
function parseReminders(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    const parts = line.split('|').map((s) => (s || '').trim());
    const title = parts[0];
    if (!title) return null;
    const days = parseInt(String(parts[1] || '').replace('+', ''), 10);
    const priority = ['low', 'normal', 'high'].includes(parts[2]) ? parts[2] : 'normal';
    return { title: title.slice(0, 200), offsetDays: Math.min(365, Math.max(0, Number.isFinite(days) ? days : 1)), priority };
  }).filter(Boolean);
}

function create({ name, description, fileRequestsText, remindersText }) {
  if (!name || !name.trim()) return null;
  const items = { fileRequests: parseFileRequests(fileRequestsText), reminders: parseReminders(remindersText) };
  return prisma.projectTemplate.create({
    data: { name: name.trim().slice(0, 200), description: clean(description), items: JSON.stringify(items) },
  });
}

function remove(id) {
  return prisma.projectTemplate.delete({ where: { id: Number(id) } });
}

function itemsOf(t) {
  try { const x = t.items ? JSON.parse(t.items) : {}; return { fileRequests: x.fileRequests || [], reminders: x.reminders || [] }; } catch (_) { return { fileRequests: [], reminders: [] }; }
}

// Rozstawia szablon na świeżo utworzonym projekcie. Zwraca liczbę utworzonych elementów.
async function applyToProject(templateId, project, now = new Date()) {
  const t = await getById(templateId);
  if (!t) return { fileRequests: 0, reminders: 0 };
  const items = itemsOf(t);
  for (const fr of items.fileRequests) {
    await prisma.fileRequest.create({ data: { projectId: project.id, label: fr.label, note: fr.note || null } });
  }
  for (const r of items.reminders) {
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + r.offsetDays, 9, 0, 0);
    await reminderService.create({ title: r.title, dueAt: due, priority: r.priority, projectId: project.id, clientId: project.clientId || undefined });
  }
  return { fileRequests: items.fileRequests.length, reminders: items.reminders.length };
}

module.exports = { list, getById, create, remove, itemsOf, applyToProject, parseFileRequests, parseReminders };
