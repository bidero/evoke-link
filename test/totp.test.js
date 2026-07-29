// TOTP — zgodność z RFC 6238 (oficjalne wektory testowe) + base32 + kody zapasowe.
// Własna implementacja na wbudowanym `crypto` (bez zależności), więc test jest
// kluczowy: sprawdza, że generujemy DOKŁADNIE to, czego oczekują aplikacje 2FA.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const totp = require('../src/utils/totp');

// RFC 6238 Appendix B: sekret ASCII "12345678901234567890" (SHA1).
const SECRET_ASCII = '12345678901234567890';
const SECRET_B32 = totp.base32Encode(Buffer.from(SECRET_ASCII, 'ascii'));

test('TOTP: wektory testowe RFC 6238 (SHA1, 8 cyfr)', () => {
  // [czas w sekundach, oczekiwany kod 8-cyfrowy]
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [secs, expected] of vectors) {
    const got = totp.generate(SECRET_B32, { time: secs * 1000, digits: 8 });
    assert.equal(got, expected, `RFC 6238 t=${secs}`);
  }
});

test('base32: round-trip + zgodność z RFC 4648', () => {
  assert.equal(totp.base32Encode(Buffer.from('foobar', 'ascii')), 'MZXW6YTBOI');
  assert.equal(totp.base32Decode('MZXW6YTBOI').toString('ascii'), 'foobar');
  const secret = totp.generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/, 'sekret 20 bajtów = 32 znaki base32');
  assert.equal(totp.base32Decode(secret).length, 20);
});

test('TOTP verify: poprawny kod, tolerancja ±30 s, odrzucenie złego', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const code = totp.generate(secret, { time: now });

  assert.equal(totp.verify(secret, code, { time: now }), true, 'bieżący kod przechodzi');
  assert.equal(totp.verify(secret, code, { time: now + 30000 }), true, 'kod sprzed 30 s (tolerancja)');
  assert.equal(totp.verify(secret, code, { time: now - 30000 }), true, 'kod „z przyszłości" 30 s');
  assert.equal(totp.verify(secret, code, { time: now + 120000 }), false, 'kod po 2 min odrzucony');
  assert.equal(totp.verify(secret, '000000', { time: now }), false, 'zły kod odrzucony');
  assert.equal(totp.verify(secret, '', { time: now }), false, 'pusty kod odrzucony');
  assert.equal(totp.verify(secret, '12345', { time: now }), false, 'zła długość odrzucona');
  // spacje/myślniki w kodzie z aplikacji nie przeszkadzają
  assert.equal(totp.verify(secret, code.slice(0, 3) + ' ' + code.slice(3), { time: now }), true, 'kod ze spacją');
});

test('otpauth URI + kody zapasowe', () => {
  const uri = totp.otpauthUri({ secret: 'ABCD', account: 'admin@firma.pl', issuer: 'Evoke LINK' });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=ABCD/);
  assert.match(uri, /issuer=Evoke\+LINK/);

  const codes = totp.generateRecoveryCodes();
  assert.equal(codes.length, 10, '10 kodów zapasowych');
  assert.ok(codes.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)), 'format XXXX-XXXX');
  assert.equal(new Set(codes).size, 10, 'kody unikalne');
  assert.equal(totp.normalizeRecovery('abcd-1234'), 'ABCD1234', 'normalizacja kodu');
});
