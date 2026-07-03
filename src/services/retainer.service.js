// Retainery — cykliczne pozycje rozliczeniowe klienta (np. miesięczny abonament).
// Cron (jobs/reminders.job → runRetainers) raz dziennie tworzy z aktywnych retainerów
// zwykłe pozycje Charge (netto + VAT, termin +dueDays) — dalej działają istniejące
// przypomnienia, sumy, kafelki i PDF. Anty-duplikat: `lastPeriod` = 'YYYY-MM'.
// Nie generujemy wstecz — jeśli aplikacja przespała cały miesiąc, tworzymy tylko bieżący okres.
const prisma = require('../db/client');
const chargeService = require('./charge.service');
const events = require('./event.service');
const fmt = require('../utils/format');

const MONTHS_PL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const periodKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const clean = (v) => (v && v.trim() ? v.trim() : null);

function listByClient(clientId) {
  return prisma.retainer.findMany({ where: { clientId: Number(clientId) }, orderBy: { createdAt: 'asc' } });
}

function getById(id) {
  return prisma.retainer.findUnique({ where: { id: Number(id) } });
}

function create(clientId, { label, amount, vatRate, dayOfMonth, dueDays, note }) {
  const amt = chargeService.parseAmount(amount);
  if (!amt || !label || !label.trim()) return null;
  const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 1));
  const dueParsed = parseInt(dueDays, 10);
  const due = Math.min(60, Math.max(0, Number.isFinite(dueParsed) ? dueParsed : 7));
  return prisma.retainer.create({
    data: {
      clientId: Number(clientId),
      label: label.trim().slice(0, 200),
      amount: amt,
      vatRate: chargeService.parseVatRate(vatRate),
      dayOfMonth: day,
      dueDays: due,
      note: clean(note),
    },
  });
}

async function toggle(id) {
  const r = await getById(id);
  if (!r) return null;
  return prisma.retainer.update({ where: { id: r.id }, data: { active: !r.active } });
}

function remove(id) {
  return prisma.retainer.delete({ where: { id: Number(id) } });
}

// Tworzy pozycję Charge z retainera dla okresu `now`. Zwraca charge albo null (już wygenerowany).
async function generateFrom(r, now = new Date()) {
  const period = periodKey(now);
  if (r.lastPeriod === period) return null;
  const label = `${r.label} — ${MONTHS_PL[now.getMonth()]} ${now.getFullYear()}`;
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + r.dueDays);
  const charge = await prisma.charge.create({
    data: { clientId: r.clientId, label, amount: r.amount, vatRate: r.vatRate, date, dueDate },
  });
  await prisma.retainer.update({ where: { id: r.id }, data: { lastPeriod: period } });
  await events.log({ type: 'created', message: `Pozycja cykliczna: ${label} (${fmt.money(chargeService.grossOf(charge))})`, clientId: r.clientId });
  return charge;
}

// Cron: generuje pozycje z aktywnych retainerów, którym w tym miesiącu minął dzień generowania.
async function generateDue(now = new Date()) {
  const period = periodKey(now);
  const due = await prisma.retainer.findMany({
    where: { active: true, dayOfMonth: { lte: now.getDate() }, OR: [{ lastPeriod: null }, { lastPeriod: { not: period } }] },
  });
  let n = 0;
  for (const r of due) {
    if (await generateFrom(r, now)) n++;
  }
  return n;
}

// Ręczne „Wygeneruj teraz" z kartoteki (bez czekania na dzień miesiąca; ten sam anty-duplikat).
async function generateNow(id, now = new Date()) {
  const r = await getById(id);
  if (!r || !r.active) return null;
  return generateFrom(r, now);
}

// MRR — stały miesięczny przychód BRUTTO z aktywnych retainerów (kafelek Pulsu + widżet).
async function mrrActive() {
  const items = await prisma.retainer.findMany({
    where: { active: true },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { amount: 'desc' },
  });
  const withGross = items.map((r) => ({ ...r, gross: chargeService.grossOf(r) }));
  return { mrr: withGross.reduce((s, r) => s + r.gross, 0), count: withGross.length, items: withGross };
}

module.exports = { listByClient, getById, create, toggle, remove, generateFrom, generateDue, generateNow, mrrActive, periodKey };
