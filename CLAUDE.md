# Evoke LINK — przewodnik projektu (dla Claude i dewelopera)

Prywatny system wymiany plików agencja ↔ klient (uproszczony, „agencyjny" WeTransfer).
Działa w dwóch kierunkach i grupuje wszystko w **Projektach**. Nazwa aplikacji: **Evoke LINK**
(katalog/repo: `evoke-link`; w historii bywała nazywana „Evoke Transfer").

Domena produkcyjna: **link.evoke.pl** (na razie dev lokalny; produkcja to finalny etap).

## Stack (i dlaczego taki)
- **Node.js + Express** — prosty, znajomy (deweloper ma tło PHP/WordPress).
- **SQLite + Prisma** — zero serwera bazy; backup = kopia pliku. Łatwa migracja na PostgreSQL (zmiana providera).
- **EJS + Tailwind (v3, CLI) + Alpine.js** — szablony serwerowe zamiast SPA: mniej kodu, łatwe utrzymanie, brak builda JS. Alpine z CDN (uwaga: strona klienta wymaga internetu — przed produkcją wrzucić lokalnie).
- **CommonJS** (require), nie ESM.
- Biblioteki świadomie „shared-hosting-safe" (bez kompilacji natywnej): **bcryptjs** (nie bcrypt), **cookie-session** (nie session-file-store — ten rzucał EPERM na Windows; cookie-session przeżywa restart i działa wszędzie), tokeny przez `crypto`, ZIP przez `archiver` (strumieniowo), mail przez `nodemailer`, upload przez `multer`.

## Uruchomienie lokalne
```bash
npm install
npm run prisma:deploy     # zastosuj migracje (dev: prisma migrate dev)
npm run build:css         # Tailwind → public/css/app.css (po każdej zmianie klas!)
npm start                 # http://localhost:3000 → /admin/login (dane z .env)
```
Login admina: `.env` → `ADMIN_EMAIL` / `ADMIN_PASSWORD` (lub `ADMIN_PASSWORD_HASH`, `npm run hash -- "haslo"`).

## Hosting / deploy (SeoHost.pl, DirectAdmin + Passenger)
- Plik startowy: `app.js` (root). Restart: `touch tmp/restart.txt`.
- Deploy: `git pull && npm install && npm run prisma:deploy && npm run build:css && touch tmp/restart.txt`.
- Sprzątanie wygasłych: cron w DirectAdmin → `node src/jobs/cleanup.job.js` (NIE node-cron — Passenger usypia proces).
- Duże pliki: upload na razie zwykły multipart; przed produkcją dołożyć **chunked upload** (limit rozmiaru requestu na shared hostingu).

## Struktura
```
app.js                    entry (Passenger)
src/app.js                konfiguracja Express
src/config/               wczytanie .env
src/db/client.js          singleton Prisma
src/routes/               admin / public / auth
src/controllers/          obsługa requestów (cienka warstwa)
src/services/             logika: transfer, project, storage, zip, mail, event, auth
src/middleware/           auth, upload (multer), error
src/utils/                format (rozmiary/daty), icons (helper SVG Lucide)
src/views/                EJS (layouts / admin / public / errors)
src/jobs/cleanup.job.js   cron
prisma/schema.prisma      model danych
storage/                  pliki użytkowników + evoke.db (poza repo, .gitignore)
```

## Model danych (Prisma)
- **User** — konto agencji (w MVP logowanie z `.env`, tabela pod przyszłość).
- **Project** — pojemnik. `clientToken` (unikalny, link panelu klienta `/p/:token`), `clientPasswordHash` (opc.), `status` active|archived.
- **Transfer** — JEDEN model dla obu kierunków: `direction` = `outgoing` (agencja→klient, `/t/:token`) lub `incoming` (klient→agencja, `/upload/:token`). Pola: `token`, `passwordHash?`, `expiresAt?`, `maxDownloads?`, `downloadCount`, `clientVisible` (czy w panelu klienta), `projectId?`, `status` active|expired|deleted.
- **File** — `originalName`, `storedName`, `storedPath` (względna do storage), `size` (BigInt!), `mimeType`. onDelete Cascade.
- **Event** — historia + powiadomienia + dane widżetów. `type` (created|downloaded|uploaded|updated|expired|error), `projectId?`, `transferId?`, `isRead`, `meta` (JSON string).
- **Settings** — branding (1 rekord) — używane dopiero w Etapie 5.

## Konwencje i pułapki (WAŻNE)
- **Warstwa storage** (`storage.service.js`) — wszystkie operacje na plikach przez nią (łatwa zmiana na S3). Pliki w `storage/transfers/<token>/`.
- **Ikony**: `<%- icon('nazwa') %>` / `<%- eventIcon(type) %>` (helper `src/utils/icons.js`) — kontur w stylu Lucide, kolor `brand-600` (#6e00a5). BEZ emoji.
- **Kolor przewodni**: `#6e00a5` = `brand-600` (paleta `brand-*` w `tailwind.config.js`). Używać klas `brand-*`, nie `indigo-*`. Tailwind skanuje `src/views`, `src/assets/js`, `src/utils`.
- **Sesja**: cookie-session. Wylogowanie = `req.session = null` (NIE `.destroy()`).
- **Hasła** (transfer/projekt): bcryptjs; odblokowanie zapamiętane w sesji (`unlocked` / `portalUnlocked`).
- **Formularze uploadu (`new.ejs`, `upload.ejs`, `portal.ejs`)** wysyłają pliki przez **XHR** i ręcznie doklejają pola do FormData — przy dodaniu nowego pola PAMIĘTAJ dopisać je w skrypcie (był bug: `projectId`/`clientVisible` nie były wysyłane).
- **Prisma generate** na Windows rzuca `EPERM` na pliku silnika, gdy działa lokalny serwer → **zatrzymaj serwer przed `prisma generate`/`npm install`**.
- **Migracje**: `prisma migrate dev` bywa nieinteraktywne i odmawia przy ostrzeżeniach (np. nowy UNIQUE index). Wtedy: napisz `prisma/migrations/<ts>_nazwa/migration.sql` ręcznie i `prisma migrate deploy`.
- **BigInt**: `File.size` to BigInt — formatować przez `fmt.bytes()`, nie serializować wprost do JSON.
- **Po zmianie klas Tailwind**: `npm run build:css`. **Po zmianie tylko widoków EJS**: wystarczy refresh (dev nie cache'uje).

## Testy
Brak frameworka — używamy doraźnych skryptów E2E: krótki `scripts/*-test.js` startuje `app.listen(0)`, woła endpointy przez globalny `fetch`/`FormData` (Node 18+), sprząta dane i kasuje się po przebiegu. Uwaga: cookie-session ustawia 2 ciasteczka (`evoke` + `evoke.sig`) — w teście brać oba przez `res.headers.getSetCookie()`.

## Status / roadmapa
- [x] Etap 0 — szkielet, logowanie, layout, model danych
- [x] Etap 1 — transfery wychodzące (`/t/:token`, hasło, wygasanie, limit, ZIP, edycja)
- [x] Etap 2 — uploady przychodzące (`/upload/:token`, e-mail)
- [x] Etap 3 — projekty + historia
- [x] Etap 4 — dashboard (realne dane) + powiadomienia (dzwonek, licznik)
- [x] Panel klienta — portal projektu `/p/:token` (hasło, widoczność per transfer `clientVisible`, pobieranie + upload)
- [ ] Etap 5 — customizacja (logo/kolory/treści z panelu; model Settings)
- [ ] Etap 6 — premium UI strony klienta (tło/gradient/ziarno) + Alpine lokalnie + CSP

## Workflow Git
Nie pushować automatycznie. Bump wersji + wpis w changelogu dopiero po potwierdzeniu. W komunikatach/URL-ach redagować token dostępowy.
