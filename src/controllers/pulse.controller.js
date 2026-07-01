// Puls agencji — analityka z istniejących danych (przychód, należności, dostarczenia, klienci).
const stats = require('../services/stats.service');

async function showPulse(req, res, next) {
  try {
    res.render('admin/pulse', { title: 'Puls agencji', active: 'pulse', pulse: await stats.pulse() });
  } catch (err) {
    next(err);
  }
}

module.exports = { showPulse };
