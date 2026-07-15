// Lista kopii zapasowych: list/filePath/remove (sanityzacja nazw — zero traversal)
// + trasy panelu wymagają logowania. Tworzy sztuczny ZIP w BACKUP_DIR i sprząta po sobie.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const app = require('../src/app');
const prisma = require('../src/db/client');
const backup = require('../src/services/backup.service');

let base, server;
before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });

test('backup.list/filePath/remove: lista, sanityzacja nazwy, kasowanie', () => {
  const name = 'evoke-backup-test-listy.zip';
  const p = path.join(backup.BACKUP_DIR, name);
  fs.mkdirSync(backup.BACKUP_DIR, { recursive: true });
  fs.writeFileSync(p, 'nie-prawdziwy-zip');
  try {
    const found = backup.list().find((b) => b.name === name);
    assert.ok(found, 'lista zawiera utworzoną kopię');
    assert.equal(found.size, fs.statSync(p).size);

    // sanityzacja: traversal / złe wzorce → null
    assert.equal(backup.filePath('../evoke-backup-test-listy.zip'), null);
    assert.equal(backup.filePath('..\\evil.zip'), null);
    assert.equal(backup.filePath('dowolny-plik.zip'), null, 'tylko wzorzec evoke-backup-*.zip');
    assert.equal(backup.filePath('evoke-backup-nieistnieje.zip'), null, 'brak pliku = null');
    assert.equal(backup.filePath(name), p, 'poprawna nazwa → pełna ścieżka');

    assert.equal(backup.remove('../' + name), false, 'remove odrzuca traversal');
    assert.ok(fs.existsSync(p), 'plik nietknięty po odrzuconym remove');
    assert.equal(backup.remove(name), true);
    assert.ok(!fs.existsSync(p), 'plik skasowany');
  } finally {
    try { fs.rmSync(p); } catch (_) { /* już usunięty */ }
  }
});

test('trasy listy kopii wymagają logowania', async () => {
  const g = await fetch(`${base}/admin/settings/backups/evoke-backup-x.zip`, { redirect: 'manual' });
  assert.equal(g.status, 302, 'pobranie bez logowania → redirect na login');
  const d = await fetch(`${base}/admin/settings/backups/evoke-backup-x.zip/delete`, { method: 'POST', redirect: 'manual' });
  assert.equal(d.status, 302, 'usunięcie bez logowania → redirect na login');
});
