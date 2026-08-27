// Wspólna ODPOWIEDŹ pollingu wątku po stronie klienta (/p /c /t /upload /o).
// Podział odpowiedzialności: KONTROLER rozpoznaje token i przechodzi swoją bramkę (hasło,
// dostępność) — to jest zabezpieczenie; TUTAJ jest już tylko render bąbelków i JSON, żeby pięć
// powierzchni nie powielało tej samej logiki. Bąbelki renderuje ten sam partial co strona wątku.
const messageService = require('../services/message.service');

function renderToString(res, view, locals) {
  return new Promise((resolve, reject) => {
    res.render(view, { ...locals, layout: false }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

// scope: { projectId } | { clientId } | { transferId } — DOKŁADNIE ten sam, którego używa
// `showMessages` danej powierzchni (inaczej klient zobaczyłby inny wątek niż jego własny).
// meta=true → sama informacja „czy przyszło coś od agencji" (do kropki przy kopercie na stronach
// portalu). Bez renderu bąbelków: jedno zapytanie i kilkadziesiąt bajtów odpowiedzi.
async function respond(res, { scope, after, msgContext, meta }) {
  const cursor = Number(after) || 0;
  const fresh = await messageService.newerThan(scope, cursor);
  if (meta) {
    return res.set('Cache-Control', 'no-store').json({
      lastId: fresh.length ? fresh[fresh.length - 1].id : cursor,
      // Liczymy TYLKO `out` — własna wiadomość klienta nie ma zapalać mu kropki.
      fromAgency: fresh.filter((m) => m.direction === 'out').length,
    });
  }
  let html = '';
  for (const mm of fresh) html += await renderToString(res, 'public/_msg_bubble', { mm, msgContext });
  // Ptaszki u klienta dotyczą JEGO wiadomości (direction 'in') — czy agencja już je przeczytała.
  const readIds = await messageService.readIdsFor(messageService.scopeWhere(scope), 'in');
  res.set('Cache-Control', 'no-store').json({
    lastId: fresh.length ? fresh[fresh.length - 1].id : cursor,
    html,
    readIds,
  });
}

module.exports = { respond, renderToString };
