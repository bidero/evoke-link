// Oferty/wyceny do akceptacji przez klienta (/o/:token). Po akceptacji pozycje oferty
// stają się zwykłymi Charge, a powiązany projekt w fazie „lead" przechodzi na „active".
// Definicja pozycji TEKSTEM (linia = pozycja: „Etykieta | netto | vat | ilość") — zero JS w formularzu.
const crypto = require('crypto');
const prisma = require('../db/client');
const chargeService = require('./charge.service');
const projectService = require('./project.service');
const events = require('./event.service');
const fmt = require('../utils/format');

function makeToken() {
  return crypto.randomBytes(9).toString('base64url');
}
const clean = (v) => (v && v.trim() ? v.trim() : null);
const INCLUDE = { items: { orderBy: { position: 'asc' } }, client: { select: { id: true, name: true, email: true } }, project: { select: { id: true, name: true, stage: true } } };

// Parsuje pozycje z tekstu. Linia: „Etykieta | netto | vat | ilość" (netto wymagane; vat/ilość opc.).
function parseItems(text) {
  return String(text || '').split(/\r?\n/).map((line, i) => {
    const p = line.split('|').map((s) => (s || '').trim());
    const label = p[0];
    const amount = chargeService.parseAmount(p[1]);
    if (!label || !amount) return null;
    const qty = Math.min(9999, Math.max(1, parseInt(p[3], 10) || 1));
    return { label: label.slice(0, 200), amount, vatRate: chargeService.parseVatRate(p[2]), qty, position: i };
  }).filter(Boolean);
}

function list(clientId) {
  return prisma.offer.findMany({ where: { clientId: Number(clientId) }, include: INCLUDE, orderBy: { createdAt: 'desc' } });
}
function getById(id) {
  return prisma.offer.findUnique({ where: { id: Number(id) }, include: INCLUDE });
}
function getByToken(token) {
  return prisma.offer.findUnique({ where: { token }, include: INCLUDE });
}

// Sumy oferty/pozycji (BRUTTO = netto*ilość + VAT). Zgodne z chargeService.grossOf.
function totals(items) {
  let net = 0; let vat = 0;
  for (const it of items) {
    const lineNet = it.amount * it.qty;
    net += lineNet;
    vat += it.vatRate ? Math.round((lineNet * it.vatRate) / 100) : 0;
  }
  return { net, vat, gross: net + vat };
}

// Stan do widoku: 'open' | 'accepted' | 'rejected' | 'expired' (open po terminie ważności).
function state(offer) {
  if (offer.status === 'accepted') return 'accepted';
  if (offer.status === 'rejected') return 'rejected';
  if (offer.validUntil && new Date(offer.validUntil) < new Date()) return 'expired';
  return 'open';
}

async function create(clientId, { projectId, title, intro, validUntil, itemsText }) {
  const items = parseItems(itemsText);
  if (!title || !title.trim() || !items.length) return null;
  return prisma.offer.create({
    data: {
      clientId: Number(clientId),
      projectId: projectId ? Number(projectId) : null,
      token: makeToken(),
      title: title.trim().slice(0, 200),
      intro: clean(intro),
      validUntil: validUntil ? new Date(validUntil) : null,
      items: { create: items },
    },
    include: INCLUDE,
  });
}

function remove(id) {
  return prisma.offer.delete({ where: { id: Number(id) } });
}

// Decyzja klienta. decision: 'accepted' | 'rejected'. Tylko dla oferty 'open' (idempotentne).
// Akceptacja: pozycje → Charge (projektowe lub wprost na kliencie), projekt lead→active.
// Zwraca { ok, offer } lub { ok: false } gdy oferta nie jest już otwarta / wygasła.
async function decide(offer, { decision, name, comment }) {
  if (state(offer) !== 'open') return { ok: false };
  const status = decision === 'accepted' ? 'accepted' : 'rejected';
  const updated = await prisma.offer.update({
    where: { id: offer.id },
    data: { status, decidedAt: new Date(), decisionName: clean(name), decisionComment: clean(comment) },
  });

  if (status === 'accepted') {
    for (const it of offer.items) {
      await chargeService.create({
        projectId: offer.projectId || null,
        clientId: offer.clientId,
        label: it.qty > 1 ? `${it.label} ×${it.qty}` : it.label,
        amount: it.amount * it.qty, // netto łącznie za pozycję
        vatRate: it.vatRate === null ? undefined : it.vatRate,
        note: `Z oferty: ${offer.title}`,
      });
    }
    // Kanban: świeżo zaakceptowana oferta rusza projekt z „lead" na „active".
    if (offer.project && offer.project.stage === 'lead') {
      await projectService.setStage(offer.projectId, 'active');
    }
    const g = fmt.money(totals(offer.items).gross);
    await events.log({ type: 'offer_accepted', message: `Klient zaakceptował ofertę „${offer.title}" (${g})`, clientId: offer.clientId, projectId: offer.projectId || undefined });
  } else {
    await events.log({ type: 'offer_rejected', message: `Klient odrzucił ofertę „${offer.title}"${comment ? ' — ' + comment : ''}`, clientId: offer.clientId, projectId: offer.projectId || undefined });
  }
  return { ok: true, offer: updated };
}

module.exports = { list, getById, getByToken, totals, state, create, remove, decide, parseItems };
