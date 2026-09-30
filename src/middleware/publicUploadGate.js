// Bramki dla PUBLICZNYCH endpointów kawałków uploadu (`/upload/:token/chunk`, `/p/:token/chunk`).
//
// DLACZEGO: kawałek (do 8 MB) trafia na dysk (storage/tmp/chunks) i leży tam do sprzątania po
// 24 h. Bez tej bramki endpoint przyjmował dane dla DOWOLNEGO tokenu, także nieistniejącego
// i bez podania hasła — każdy z internetu mógł zapełnić dysk serwera. Sprawdzamy to samo co
// kontroler przy finalizacji uploadu: link istnieje, jest aktywny i (jeśli ma hasło) został
// odblokowany w tej sesji. Stoją PRZED parserem kawałka, więc odrzucone żądanie nie jest nawet
// wczytywane do pamięci.
// Lekkie zapytania (bez plików/transferów) — bramka wykonuje się dla KAŻDEGO kawałka
// (plik 2 GB = ~400 żądań), więc nie wczytujemy tu całego projektu z listą plików.
const prisma = require('../db/client');
const transferService = require('../services/transfer.service');
const projectService = require('../services/project.service');

function deny(res, status, error) {
  return res.status(status).json({ error });
}

// /upload/:token/chunk — link uploadu (transfer przychodzący).
async function incomingChunkGate(req, res, next) {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { token: String(req.params.token || '') } });
    if (!transfer || transfer.direction !== 'incoming') return deny(res, 404, 'not_found');
    if (!transferService.checkAvailability(transfer).ok) return deny(res, 410, 'unavailable');
    const unlocked = req.session && req.session.unlocked && req.session.unlocked[transfer.token];
    if (transferService.requiresPassword(transfer) && !unlocked) return deny(res, 403, 'locked');
    return next();
  } catch (err) {
    return next(err);
  }
}

// /p/:token/chunk — portal projektu.
async function portalChunkGate(req, res, next) {
  try {
    const project = await prisma.project.findUnique({
      where: { clientToken: String(req.params.token || '') },
      select: { clientToken: true, status: true, clientPasswordHash: true },
    });
    if (!project || project.status === 'deleted') return deny(res, 404, 'not_found');
    const unlocked = req.session && req.session.portalUnlocked && req.session.portalUnlocked[project.clientToken];
    if (projectService.requiresClientPassword(project) && !unlocked) return deny(res, 403, 'locked');
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { incomingChunkGate, portalChunkGate };
