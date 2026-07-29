// Konfigurowalne szybkie akcje (panelUi): domyślne widoczne + konfiguracja + sanitize.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const panelUi = require('../src/utils/panelUi');

test('szybkie akcje: mergeActions domyślne + konfiguracja + sanitizeActions', () => {
  const visible = panelUi.mergeActions([]).filter((a) => !a.hidden).map((a) => a.key);
  assert.deepEqual(visible, ['transfer', 'upload', 'project', 'client'], 'domyślnie widoczne 4');

  const cfg = panelUi.mergeActions([{ key: 'calendar', hidden: false }, { key: 'client', hidden: true }]);
  const byKey = Object.fromEntries(cfg.map((a) => [a.key, a.hidden]));
  assert.equal(byKey.calendar, false, 'kalendarz włączony przez konfigurację');
  assert.equal(byKey.client, true, 'klient wyłączony przez konfigurację');
  assert.equal(byKey.transfer, false, 'transfer nadal domyślnie widoczny (brak w konfiguracji → default on)');

  const san = panelUi.sanitizeActions([{ key: 'calendar', hidden: false }, { key: 'zmyslony', hidden: false }, { key: 'calendar', hidden: true }]);
  assert.deepEqual(san, [{ key: 'calendar', hidden: false }], 'tylko znany klucz, bez duplikatu');
});
