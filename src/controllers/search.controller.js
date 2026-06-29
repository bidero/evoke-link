// Globalna wyszukiwarka panelu.
const searchService = require('../services/search.service');

async function index(req, res, next) {
  try {
    const r = await searchService.search(req.query.q || '');
    res.render('admin/search', { title: 'Szukaj', active: '', q: r.q, results: r });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
