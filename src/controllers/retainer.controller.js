// Retainery — cykliczne pozycje rozliczeniowe klienta (sekcja w kartotece 360°,
// zakładka „Rozliczenia"). Generowanie do Charge robi cron; tu CRUD + „Wygeneruj teraz".
const retainerService = require('../services/retainer.service');
const clientService = require('../services/client.service');

const back = (clientId, status) => `/admin/clients/${clientId}?tab=rozliczenia&sent=${status}#rozliczenia`;

async function createRetainer(req, res, next) {
  try {
    const client = await clientService.getById(req.params.id);
    if (!client) return res.status(404).render('errors/404', { title: 'Nie znaleziono', layout: 'layouts/auth' });
    const { label, amount, vatRate, dayOfMonth, dueDays } = req.body;
    const created = await retainerService.create(client.id, { label, amount, vatRate, dayOfMonth, dueDays });
    res.redirect(back(client.id, created ? 'ret-new' : 'ret-invalid'));
  } catch (err) {
    next(err);
  }
}

// Należy do klienta z URL-a? (ochrona przed pomieszaniem identyfikatorów)
async function ownRetainer(req) {
  const r = await retainerService.getById(req.params.rid);
  return r && r.clientId === Number(req.params.id) ? r : null;
}

async function toggleRetainer(req, res, next) {
  try {
    const r = await ownRetainer(req);
    if (r) await retainerService.toggle(r.id);
    res.redirect(back(req.params.id, r ? (r.active ? 'ret-off' : 'ret-on') : 'ret-invalid'));
  } catch (err) {
    next(err);
  }
}

async function deleteRetainer(req, res, next) {
  try {
    const r = await ownRetainer(req);
    if (r) await retainerService.remove(r.id);
    res.redirect(back(req.params.id, r ? 'ret-del' : 'ret-invalid'));
  } catch (err) {
    next(err);
  }
}

// Ręczne wygenerowanie pozycji za bieżący miesiąc (anty-duplikat w serwisie).
async function generateRetainer(req, res, next) {
  try {
    const r = await ownRetainer(req);
    const charge = r ? await retainerService.generateNow(r.id) : null;
    res.redirect(back(req.params.id, charge ? 'ret-gen' : 'ret-dup'));
  } catch (err) {
    next(err);
  }
}

module.exports = { createRetainer, toggleRetainer, deleteRetainer, generateRetainer };
