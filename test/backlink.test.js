// Kontekstowy „wstecz": resolve tokenu from=<typ>:<id> → { href, label } albo null.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const backlink = require('../src/utils/backlink');

test('backlink.resolve: typy id-owe i kontekstowe', () => {
  assert.deepEqual(backlink.resolve('client:5'), { href: '/admin/clients/5', label: 'Wróć do klienta' });
  assert.deepEqual(backlink.resolve('project:12'), { href: '/admin/projects/12', label: 'Wróć do projektu' });
  assert.deepEqual(backlink.resolve('board'), { href: '/admin/projects/board', label: 'Wróć do tablicy' });
  assert.deepEqual(backlink.resolve('calendar'), { href: '/admin/calendar', label: 'Wróć do kalendarza' });
  assert.equal(backlink.resolve('search:kowalski').href, '/admin/search?q=kowalski');
  assert.match(backlink.resolve('search:jan kowalski').href, /q=jan%20kowalski/); // enkodowanie
});

test('backlink.resolve: nieprawidłowe/puste → null (bez open-redirect)', () => {
  assert.equal(backlink.resolve('client:abc'), null);
  assert.equal(backlink.resolve('client:'), null);
  assert.equal(backlink.resolve('client:-3'), null);
  assert.equal(backlink.resolve('nieznany:1'), null);
  assert.equal(backlink.resolve('search:'), null);
  assert.equal(backlink.resolve(''), null);
  assert.equal(backlink.resolve(undefined), null);
  assert.equal(backlink.resolve(null), null);
});
