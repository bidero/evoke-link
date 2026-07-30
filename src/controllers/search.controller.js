// Globalna wyszukiwarka panelu: pełna strona wyników + JSON dla palety (Cmd/Ctrl+K).
const searchService = require('../services/search.service');
const avatarUtil = require('../utils/avatar');

async function index(req, res, next) {
  try {
    const r = await searchService.search(req.query.q || '');
    res.render('admin/search', { title: 'Szukaj', active: '', q: r.q, results: r });
  } catch (err) {
    next(err);
  }
}

// JSON dla palety — ten sam serwis co strona wyników, spłaszczony do grup
// { label, icon, items: [{label, sub, href}] }. Po 6 pozycji na grupę (paleta ma być krótka).
const PER_GROUP = 6;

async function json(req, res, next) {
  try {
    const r = await searchService.search(req.query.q || '', PER_GROUP);
    const groups = [
      {
        key: 'clients', label: 'Klienci', icon: 'users',
        items: r.clients.map((c) => ({
          label: c.name,
          avatar: avatarUtil.html(c, { size: 'xs' }), // awatar/logo klienta (gotowy HTML — client-side nie mamy helpera)
          sub: [c.company, c.email].filter(Boolean).join(' · '),
          href: `/admin/clients/${c.id}?from=search:${encodeURIComponent(r.q)}`,
        })),
      },
      {
        key: 'projects', label: 'Projekty', icon: 'folder',
        items: r.projects.map((p) => ({
          label: p.name,
          sub: [(p.client && p.client.name) || p.clientName, p._count.transfers + ' transf.'].filter(Boolean).join(' · '),
          href: `/admin/projects/${p.id}?from=search:${encodeURIComponent(r.q)}`,
        })),
      },
      {
        key: 'transfers', label: 'Transfery', icon: 'send',
        items: r.transfers.map((t) => ({
          label: t.title || t.token,
          sub: [t.project && t.project.name, t._count.files + ' plik(ów)'].filter(Boolean).join(' · '),
          href: `/admin/transfers/${t.id}?from=search:${encodeURIComponent(r.q)}`,
        })),
      },
    ].filter((g) => g.items.length);
    res.json({ q: r.q, groups });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, json };
