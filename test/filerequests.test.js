// Lista braków: checklist materiałów od klienta (admin CRUD + portal + auto-odhaczenie uploadem).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const storage = require('../src/services/storage.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function login() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  const r = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

test('lista braków: dodaj/odhacz/portal/auto-fulfill przez upload', async (t) => {
  const cookie = await login();
  if (!cookie) return t.skip('brak ADMIN_PASSWORD w .env');

  const token = 'freq_' + Date.now();
  const p = await prisma.project.create({ data: { name: 'FReqProj', clientToken: token } });
  const uploadedTokens = [];
  try {
    // dodanie punktu z panelu
    await fetch(`${base}/admin/projects/${p.id}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ label: 'Logo w wektorze', note: 'AI lub SVG' }), redirect: 'manual' });
    const item = await prisma.fileRequest.findFirst({ where: { projectId: p.id } });
    assert.ok(item && item.label === 'Logo w wektorze' && !item.done, 'punkt utworzony');

    // checklista + select widoczne w portalu
    const html = await (await fetch(`${base}/p/${token}`)).text();
    assert.match(html, /Potrzebujemy od Ciebie/);
    assert.match(html, /Logo w wektorze/);
    assert.match(html, /Czego dotyczą te pliki\?/);

    // upload z portalu wskazany na punkt → auto-odhaczenie + link do transferu
    const fd = new FormData();
    fd.append('files', new Blob([Buffer.from('dane-logo')], { type: 'image/svg+xml' }), 'logo.svg');
    fd.append('fileRequestId', String(item.id));
    const up = await fetch(`${base}/p/${token}/upload`, { method: 'POST', body: fd, redirect: 'manual' });
    assert.equal(up.status, 302);
    await wait(300);
    const doneItem = await prisma.fileRequest.findUnique({ where: { id: item.id } });
    assert.equal(doneItem.done, true, 'auto-odhaczony');
    assert.ok(doneItem.transferId, 'powiązany z transferem uploadu');
    uploadedTokens.push((await prisma.transfer.findUnique({ where: { id: doneItem.transferId } })).token);

    // event zawiera etykietę punktu
    const ev = await prisma.event.findFirst({ where: { projectId: p.id, type: 'uploaded' }, orderBy: { id: 'desc' } });
    assert.match(ev.message, /dot\.: Logo w wektorze/);

    // ręczne cofnięcie przez agencję
    await fetch(`${base}/admin/projects/${p.id}/requests/${item.id}/toggle`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal((await prisma.fileRequest.findUnique({ where: { id: item.id } })).done, false, 'cofnięte');

    // usunięcie punktu
    await fetch(`${base}/admin/projects/${p.id}/requests/${item.id}/delete`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(await prisma.fileRequest.findUnique({ where: { id: item.id } }), null, 'usunięty');
  } finally {
    await prisma.event.deleteMany({ where: { projectId: p.id } });
    await prisma.fileRequest.deleteMany({ where: { projectId: p.id } });
    await prisma.transfer.deleteMany({ where: { projectId: p.id } });
    await prisma.project.delete({ where: { id: p.id } });
    uploadedTokens.forEach((tk) => { try { storage.removeTransfer(tk); } catch (_) {} });
  }
});
