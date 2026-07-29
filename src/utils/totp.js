// TOTP (RFC 6238) na wbudowanym `crypto` — bez zależności zewnętrznych
// (zgodnie z zasadą projektu: shared-hosting-safe, brak kompilacji natywnej).
// Zweryfikowane oficjalnymi wektorami testowymi RFC 6238 (test/totp.test.js).
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Base32 (RFC 4648, bez paddingu) — sekret w formacie, który rozumieją aplikacje 2FA.
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// Nowy sekret (20 bajtów = 160 bitów, jak w RFC 4226) w base32.
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

// HOTP (RFC 4226): licznik → 6-cyfrowy kod.
function hotp(secretBuf, counter, digits = 6, algo = 'sha1') {
  const buf = Buffer.alloc(8);
  // 64-bitowy licznik big-endian (górne 32 bity praktycznie zawsze 0, ale liczymy poprawnie).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac(algo, secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// TOTP: kod dla danego czasu (domyślnie teraz), okno 30 s.
function generate(secret, { time = Date.now(), step = 30, digits = 6, algo = 'sha1' } = {}) {
  const counter = Math.floor(time / 1000 / step);
  return hotp(base32Decode(secret), counter, digits, algo);
}

// Weryfikacja z tolerancją ±`window` kroków (domyślnie ±1 = ±30 s — zegar bywa
// przesunięty). Porównanie w stałym czasie (timingSafeEqual).
function verify(secret, token, { time = Date.now(), step = 30, digits = 6, window = 1, algo = 'sha1' } = {}) {
  const t = String(token || '').replace(/\D/g, '');
  if (t.length !== digits) return false;
  const key = base32Decode(secret);
  if (!key.length) return false;
  const counter = Math.floor(time / 1000 / step);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + i, digits, algo);
    const a = Buffer.from(expected), b = Buffer.from(t);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// URI dla aplikacji 2FA (Google Authenticator, Apple Passwords, 1Password…).
function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer || 'Evoke LINK'}:${account || 'admin'}`);
  const params = new URLSearchParams({ secret, issuer: issuer || 'Evoke LINK', algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Kody zapasowe (gdy zgubisz telefon): 10 × 8 znaków, czytelne (bez 0/O/1/I).
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCodes(count = 10, len = 8) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let c = '';
    const bytes = crypto.randomBytes(len);
    for (let j = 0; j < len; j++) c += RC_ALPHABET[bytes[j] % RC_ALPHABET.length];
    out.push(c.slice(0, 4) + '-' + c.slice(4)); // XXXX-XXXX
  }
  return out;
}
const normalizeRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

module.exports = { base32Encode, base32Decode, generateSecret, hotp, generate, verify, otpauthUri, generateRecoveryCodes, normalizeRecovery };
