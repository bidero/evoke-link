// Limity zapytań (anty brute-force). Pamięciowy store — wystarczający dla pojedynczego
// procesu Passenger; przy wielu procesach każdy liczy osobno (akceptowalne dla tej skali).
// Wyłączenie na czas dev/testów: RATE_LIMIT_DISABLED=true w .env.
const rateLimit = require('express-rate-limit');

const disabled = process.env.RATE_LIMIT_DISABLED === 'true';
const base = { standardHeaders: true, legacyHeaders: false, skip: () => disabled };

// Logowanie admina — liczymy tylko nieudane próby (sukces = 302, pomijany).
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('admin/login', {
    title: 'Logowanie',
    layout: 'layouts/auth',
    error: 'Zbyt wiele prób logowania. Odczekaj kilka minut i spróbuj ponownie.',
    email: (req.body && req.body.email) || '',
  }),
});

// Hasła do stron klienta (transfer/upload/portal) — brute-force hasła tokenowego.
const passwordLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  handler: (req, res) => res.status(429).send('Zbyt wiele prób. Spróbuj ponownie za kilka minut.'),
});

module.exports = { loginLimiter, passwordLimiter };
