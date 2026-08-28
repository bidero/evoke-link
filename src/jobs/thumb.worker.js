// Wątek roboczy generujący miniaturę. Istnieje po to, żeby synchroniczne dekodowanie JPEG
// (~2,4 s przy 12 MP) NIE blokowało pętli zdarzeń procesu obsługującego żądania.
const { workerData, parentPort } = require('worker_threads');
const thumb = require('../services/thumb.service');

const out = thumb.generate(workerData.storedPath, workerData.mime, workerData.name);
if (parentPort) parentPort.postMessage(out || null);
