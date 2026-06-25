# Evoke LINK

Prywatny system wymiany plików między agencją a klientami — prostszy, „agencyjny" WeTransfer.
Działa w dwóch kierunkach: **agencja → klient** (link do pobrania) oraz **klient → agencja**
(formularz uploadu). Wszystko grupowane w **Projektach**.

Stos: **Node.js + Express**, **SQLite** (przez Prisma), szablony **EJS + Tailwind + Alpine.js**.

## Funkcje
- 📤 **Transfery wychodzące** — wyślij pliki/folder, link `/t/:token`, hasło, data wygaśnięcia, limit pobrań, pobieranie pojedyncze lub ZIP.
- 🧩 **Upload dużych plików (chunked)** — pliki dzielone na kawałki po stronie przeglądarki (omija limity rozmiaru requestu hostingu współdzielonego); działa we wszystkich uploadach (panel, `/upload`, panel klienta).
- 📥 **Uploady przychodzące** — link `/upload/:token`, klient wgrywa pliki, agencja dostaje e-mail i powiadomienie.
- 📁 **Projekty** — grupują transfery (wysłane i odebrane) oraz pełną historię zdarzeń.
- 👤 **Panel klienta** — link `/p/:token` z plikami widocznymi dla klienta (pobieranie + upload), opcjonalne hasło.
- 🔔 **Dashboard i powiadomienia** — aktywne transfery, miejsce na dysku, dzwonek z licznikiem nieprzeczytanych.
- 🎨 **Customizacja** — z panelu, bez kodu: logo (rozmiar + pozycja, bezpieczny upload SVG), favicon, nazwa, kolor przewodni, osobne kolory panelu (akcent / sidebar / tło / czcionka), tło stron klienta (presety, **własny gradient**, obraz, **ziarno z regulacją mocy**), treści i stopka. Strona logowania brandowana jak strony klienta. Pole na **własny CSS** dla zmian ponad dostępne opcje.
- 🔑 **Konto** — zmiana hasła administratora z panelu (zapis do bazy, fallback do `.env`).

> Aplikacja dla jednej agencji: logowanie administratora, klienci korzystają wyłącznie z linków (bez kont).

---

## Wymagania

- **Node.js 18+** (na SeoHost wybierasz wersję w panelu DirectAdmin → Setup Node.js App).

---

## Uruchomienie lokalnie (na komputerze)

```bash
# 1. Zależności
npm install

# 2. Konfiguracja — skopiuj i ewentualnie dostosuj .env
#    (.env jest już utworzony; sprawdź ADMIN_EMAIL i ADMIN_PASSWORD)

# 3. Baza danych — utwórz plik SQLite wg schematu
npm run prisma:migrate        # przy pierwszym razie nazwij migrację np. "init"

# 4. Zbuduj CSS (Tailwind)
npm run build:css             # lub: npm run watch:css  (przebudowuje na bieżąco)

# 5. Start
npm start
```

Aplikacja: **http://localhost:3000** → przekierowuje do **/admin/login**.
Zaloguj się danymi z `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

### Hasło admina — wersja bezpieczniejsza
Zamiast trzymać hasło jawnie, wygeneruj jego hash i wklej do `.env`:
```bash
npm run hash -- "twoje-haslo"
# skopiuj wypisaną linię ADMIN_PASSWORD_HASH=... do .env, wyczyść ADMIN_PASSWORD
```

---

## Wdrożenie na SeoHost.pl (DirectAdmin + Passenger)

1. **Wgraj kod** przez SSH (`git clone` / `git pull`) do katalogu aplikacji,
   np. `~/domains/transfer.twojadomena.pl/app`.
2. W DirectAdmin: **Setup Node.js App**
   - *Application Root* → katalog z kodem,
   - *Application Startup File* → `app.js`,
   - wersja Node → 18+.
3. Przez SSH w katalogu aplikacji:
   ```bash
   npm install
   npm run prisma:deploy      # zakłada/aktualizuje bazę bez pytań interaktywnych
   npm run build:css
   ```
4. Ustaw zmienne środowiskowe (w panelu Node.js App lub w `.env`):
   - `NODE_ENV=production`, `APP_URL=https://transfer.twojadomena.pl`,
   - `SESSION_SECRET` (długi losowy ciąg), dane `ADMIN_*` i `SMTP_*`.
5. **Restart aplikacji** — przyciskiem w panelu lub:
   ```bash
   mkdir -p tmp && touch tmp/restart.txt
   ```
   Passenger wykrywa `tmp/restart.txt` i przeładowuje aplikację.

### Sprzątanie wygasłych transferów (cron)
W DirectAdmin → **Cron Jobs** dodaj (raz dziennie):
```
0 4 * * *  cd ~/domains/transfer.twojadomena.pl/app && node src/jobs/cleanup.job.js
```
Używamy crona systemowego zamiast `node-cron`, bo Passenger usypia proces przy braku ruchu.

---

## Ważne zasady projektu

- **Pliki użytkowników** leżą w `storage/transfers/` — poza katalogiem publicznym.
  Backup = skopiowanie `storage/` (pliki) + `storage/evoke.db` (baza).
- **Duże pliki**: od Etapu 1 upload będzie dzielony na kawałki po stronie przeglądarki
  (omija limit rozmiaru requestu hostingu współdzielonego).
- **`.env` nie trafia do repo** (jest w `.gitignore`).

---

## Struktura katalogów

```
src/
  app.js            konfiguracja Express
  config/           wczytanie .env
  db/               klient Prisma
  routes/           routing (admin / public / auth)
  controllers/      obsługa requestów
  services/         logika biznesowa (auth, transfer, zip, mail, storage…)
  middleware/       auth, obsługa błędów
  jobs/             cleanup (cron)
  views/            szablony EJS (layouts / admin / public / emails / errors)
  assets/           wejściowy CSS (Tailwind) + JS frontu
public/             statyki (zbudowany CSS, logo)
storage/            pliki użytkowników + baza SQLite (poza repo)
prisma/             schema.prisma (model danych)
app.js              punkt startowy (entry dla Passengera)
```

## Roadmapa

- [x] **Etap 0** — szkielet, logowanie, layout panelu, model danych
- [x] **Etap 1** — transfery wychodzące (upload, link `/t/:token`, hasło, wygasanie, limit, ZIP, edycja)
- [x] **Etap 2** — uploady przychodzące (formularz `/upload/:token`, e-mail do agencji)
- [x] **Etap 3** — projekty (grupowanie transferów) + historia zdarzeń
- [x] **Etap 4** — dashboard (realne dane + ostatnia aktywność) + powiadomienia (dzwonek, licznik)
- [x] **Panel klienta** — portal projektu `/p/:token` (hasło, widoczność per transfer, pobieranie + upload)
- [x] **Etap 5** — customizacja (logo, favicon, nazwa, kolor, treści z panelu; kolor przez zmienne CSS bez rebuildu)
- [x] **Etap 6** — rozszerzona customizacja: tła stron klienta (presety / własny gradient / obraz / ziarno), osobne kolory panelu, logo (rozmiar + pozycja), brandowane logowanie, zmiana hasła admina, pole na własny CSS
