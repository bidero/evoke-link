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
- Deploy: `git pull && npm install && npm run prisma:deploy && touch tmp/restart.txt`. (CSS jest w repo — NIE budujemy Tailwinda na produkcji; `prisma` jest w dependencies, więc migrate deploy działa po produkcyjnym npm install.)
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
- **Client** — klient agencji (CRM). Pola: `name` (pełna/wyświetlana nazwa), `firstName?`/`lastName?` (personalizacja maili — placeholdery `{imie}`/`{nazwisko}`), `email?`, `company?`, `phone?`, `nip?`, `address?`, `status` lead|active|inactive, `tags?`, `token` (portal klienta `/c/:token`), `note?`. Ma wiele projektów i pozycji rozliczeniowych.
- **Project** — pojemnik. `clientId?` (relacja do Client) / `clientName?` (legacy etykieta), `clientToken` (unikalny, link panelu `/p/:token`), `clientPasswordHash?`, `position` (kolejność drag&drop), `status` active|archived.
- **Charge** — pozycja rozliczeniowa, kwota w GROSZACH. Należy do `projectId?` **lub** `clientId?` (dokładnie jedno; klient pozycji = `clientId ?? project.clientId`). Pola: `label?`, `amount`, `date?`, `dueDate?` (wiekowanie należności + przypomnienia), `paidAt?`, `remindedAt?`, `note?`.
- **Transfer** — JEDEN model dla obu kierunków: `direction` = `outgoing` (agencja→klient, `/t/:token`) lub `incoming` (klient→agencja, `/upload/:token`). Pola: `token`, `passwordHash?`, `expiresAt?`, `maxDownloads?`, `downloadCount`, `clientVisible` (czy w panelu klienta), `notifyOnDownload` (e-mail przy 1. pobraniu), `projectId?`, `status` active|expired|deleted.
- **File** — `originalName`, `storedName`, `storedPath` (względna do storage), `size` (BigInt!), `mimeType`. onDelete Cascade.
- **Event** — historia + powiadomienia + dane widżetów. `type` (created|downloaded|uploaded|viewed|email_sent|note|updated|expired|error), `projectId?`, `transferId?`, `clientId?` (oś czasu klienta), `isRead`, `dismissed`, `meta` (JSON string). Powiadomienia (dzwonek) = tylko `NOTIFY_TYPES` (uploaded|downloaded|error); `viewed` jest w osi czasu, ale NIE dzwoni.
- **Message** — wiadomość klient↔agencja. `direction` in|out, kontekst `clientId?`/`projectId?`/`transferId?` (definiuje wątek), `senderName?`/`senderEmail?`, `isRead` (dla agencji). Skrzynka panelu grupuje po kontekście (wątki); klient widzi wątek w popupie + badge nowej odpowiedzi (sesja `msgSeen`).
- **Settings** — branding/customizacja (1 rekord, `id=1`). Kolumny: `appName`, `logoPath`, `faviconPath`, `ogImagePath` (obraz podglądu linku OG), `customCss` + JSON-y: `colors` (`primary`, `adminAccent`, `adminText`, `adminSidebar`, `adminHeader` (pasek nagłówka, puste=jak sidebar), `adminBg`, `darkBg/darkSurface/darkText`), `texts` (`heroTitle`, `heroSubtitle`, `footer`), `background` (`type` gradient|custom|image|solid, `preset`, `color`, `custom`, `imagePath`/`images[]`/`rotate`/`rotateSec`, `overlay`, `imageGradient`+`imageGrad`, `grain`/`grainType`/`grainStrength`, `scroll`), `logo` (`size`, `align`, `darkPath`), `layout` (`style`,`card`,`cardSide`,`radius`,`button`,`stickyHeader`,`font`,`hideName`,`heroOnBg`,`applyToLogin`), `emails` (loga/tematy/wstępy + przypomnienia), `pdf` (szablon + dane sprzedawcy).
- **User** — w MVP login z `.env`, ale `auth.service.setAdminPassword` zapisuje hash admina do tej tabeli (po zmianie hasła w panelu baza ma pierwszeństwo nad `.env`).

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
- **Customizacja (Etap 5–6)** — kluczowe miejsca:
  - Kolory bez rebuildu: paleta `brand-*` to zmienne CSS (`--brand-*`); middleware w `app.js` wstrzykuje `brandStyleTag` (z `primary`, dla stron klienta/logowania) i `adminStyleTag` (z `adminAccent` + `--admin-bg/-text/-sidebar/-sidebar-text/-header/-header-text`, dla panelu). `utils/color.js` generuje paletę + `readableText` (auto-kontrast).
  - Tło stron klienta: `utils/background.js` (`bodyStyle`/`overlayHtml`/`isDark`, presety + własny gradient `custom`, ziarno z `grainStrength`). W layoutach: `bgStyle` na `<body>`, `bgOverlay` jako nakładki (`z-0`), treść w `z-10`.
  - **Tekst na tle**: `<body>` stron klienta/logowania jest ZAWSZE ciemny (`text-slate-800`) — bo treść siedzi w białych kartach. Jasny kolor (gdy `bgDark`) dostaje tylko „chrome" na gradiencie: nagłówek (logo/nazwa) i stopka. NIE ustawiać jasnego tekstu na całym `body` (regresja: niewidoczne `h1` na kartach).
  - **x-data w `settings.ejs`**: stan wstrzykiwany przez `x-data="settingsForm(<%= JSON.stringify(formState) %>)"` — MUSI być `<%=` (HTML-escape), NIE `<%-`. Przy `<%-` cudzysłowy JSON-a urywają atrybut → Alpine pada → color-inputy czernieją (był bug „drugi zapis = czarne").
  - Upload brandingu: `middleware/brandingUpload.js` (pola `logo`/`favicon`/`bg`, do 5 MB, też SVG). SVG czyszczone przez `utils/svgSanitize.js`. Własny CSS czyszczony przez `utils/css.js` (usuwa `<`), wstrzykiwany jako `customStyleTag` we WSZYSTKICH layoutach.
  - Zmiana hasła: strona `/admin/account` (`account.controller`), `auth.service.verifyCredentials` jest **async** (sprawdza DB, potem `.env`). Reset z CLI: `npm run set-password -- "haslo"` / `-- --clear`.
  - Hero/podpis: renderowane w `layouts/public.ejs` (blok nad kartą, gdy `texts.heroTitle` ustawiony), kolor adaptacyjny do jasnego/ciemnego tła.
- **Chunked upload (dzielenie dużych plików)** — omija limit rozmiaru requestu hostingu. Architektura drop-in:
  - Klient: `public/js/chunked-upload.js` → `window.chunkedUpload(files, '<endpoint>/chunk', onProgress)` dzieli pliki na 5 MB i wysyła sekwencyjnie, zwraca `uploadId`. Potem widok wysyła żądanie tworzące (urlencoded) z nagłówkiem `X-Upload-Id`.
  - Serwer: `chunk.service.js` skleja kawałki w `storage/tmp/chunks/<uploadId>/`; `middleware/chunkUpload.js` → `receiveChunk` (endpoint `/chunk`, surowe bajty) + `receiveUpload(field)` zastępuje `multer.array` (gdy jest `X-Upload-Id` → składa pliki w `req.files` w kształcie multera, inaczej multipart fallback). **Kontrolery i serwisy bez zmian** — `req.files` ma ten sam kształt `{ originalname, path, size, mimetype }`.
  - Endpointy `/chunk` MUSZĄ być przed trasami `:id` (np. `/transfers/chunk` przed `/transfers/:id`). Porzucone sesje sprząta `chunk.sweepOld()` (start aplikacji, >24h).
  - **Równoległość**: klient wysyła kawałki współbieżnie (pula 3). Dlatego serwer zapisuje KAŻDY kawałek do osobnego pliku `<fi>_<ci>.part` i skleja je po indeksach przy `assembleFiles` (NIE dopisuje sekwencyjnie — kolejność przyjścia jest dowolna).
  - **Sklejanie jest async + strumieniowe** (`assembleFiles` zwraca Promise; `receiveUpload` robi `await`) — nie blokuje pętli zdarzeń przy dużych plikach. Klient po wysłaniu kawałków pokazuje stan „Finalizowanie…" (animowany pasek), bo na localhoście sam upload bywa zbyt szybki, by pasek był widoczny, a odczuwalne „zawieszenie" to właśnie sklejanie po stronie serwera.
- **Układ stron klienta (warianty wyglądu)** — `Settings.layout` JSON `{ style: classic|centered|split, card: solid|glass|elevated, cardSide: left|right (split), hideName, heroOnBg, applyToLogin, radius, button: rounded|pill }`. `centered` = landing z DUŻYM hero (text-5xl); `split` używa `cardSide` (kolejność przez `md:order-*`). `hideName` chowa nazwę aplikacji (placeholder w nagłówku bez logo + fallback w kolumnie hero). Tło-obraz ma opcję `background.imageGradient` (nakładka gradientu brandowego) i mocniejszy szum (mix-blend `overlay`). Render w `layouts/public.ejs` (3 warianty kompozycji). Styl karty/rogi/przycisk przez zmienne CSS (`--card-*`, `--btn-radius`) wstrzykiwane jako `surfaceStyleTag` (app.js `surfaceVars`) + wspólne klasy `.evoke-card`/`.evoke-btn` (input.css) używane przez 5 widoków publicznych i logowanie. Hero pokazywany gdy `heroTitle && heroOnBg` (na wszystkich układach).
  - **GOTCHA nazwa `uiLayout`**: ustawienia układu w res.locals są pod `uiLayout`, NIE `layout` — `layout` koliduje z express-ejs-layouts (nazwa pliku układu z kontrolera; w widoku to string).
  - **GOTCHA kontrolki**: radia/checkboxy układu w `settings.ejs` są NATYWNE (EJS `checked`, bez Alpine `x-model`/`x-for`) — wzorzec `<template x-for>`+`x-model` na radiach był zawodny w przeglądarce (nie dało się wybrać). Podświetlenie działa przez `peer-checked` natywnie. Reaktywne kontrolki (kolory/tło) dalej na Alpine, bo mają podgląd na żywo.

## Testy
Brak frameworka — używamy doraźnych skryptów E2E: krótki `scripts/*-test.js` startuje `app.listen(0)`, woła endpointy przez globalny `fetch`/`FormData` (Node 18+), sprząta dane i kasuje się po przebiegu. Uwaga: cookie-session ustawia 2 ciasteczka (`evoke` + `evoke.sig`) — w teście brać oba przez `res.headers.getSetCookie()`.

## Status / roadmapa
- [x] Etap 0 — szkielet, logowanie, layout, model danych
- [x] Etap 1 — transfery wychodzące (`/t/:token`, hasło, wygasanie, limit, ZIP, edycja)
- [x] Etap 2 — uploady przychodzące (`/upload/:token`, e-mail)
- [x] Etap 3 — projekty + historia
- [x] Etap 4 — dashboard (realne dane) + powiadomienia (dzwonek, licznik)
- [x] Panel klienta — portal projektu `/p/:token` (hasło, widoczność per transfer `clientVisible`, pobieranie + upload)
- [x] Etap 5 — customizacja (logo/kolory/treści z panelu; model Settings; kolor bez rebuildu)
- [x] Etap 6 — rozszerzona customizacja: tła stron klienta (presety/własny gradient/obraz/ziarno z mocą), osobne kolory panelu (akcent/sidebar/tło/czcionka, auto-kontrast), logo (rozmiar+pozycja, SVG sanityzowane), brandowane logowanie, zmiana hasła admina (DB), pole na własny CSS
- [x] Chunked upload — dzielenie dużych plików na 5 MB (panel + /upload + portal), drop-in z fallbackiem multipart, sprawdzone E2E (integralność md5)
- [x] Hero/podpis renderowane na stronach klienta; reset hasła z CLI (`npm run set-password`)
- [x] Warianty układu stron klienta (klasyczny/karta-na-tle/hero+karta) + styl karty (biel/szkło/uniesiona) + rogi/przycisk + branding logowania; równoległy chunked upload (pula 3)
- [x] Bezpieczeństwo/ops: backup automatyczny (`src/jobs/backup.job.js`), multer 2.x, rate-limit (login + hasła klienta), Alpine/Sortable lokalnie + CSP (helmet), nodemailer 9 (audit: 0 vuln)
- [x] Rozliczenia: `Charge` (projekt/klient, grosze, `dueDate`), kafelek przeterminowanych, CSV + PDF (pdfmake) + wysyłka mailem, przypomnienia cronem (`jobs/reminders.job.js`)
- [x] CRM: baza klientów + strona 360° (Przegląd/Projekty/Rozliczenia/Transfery/Oś czasu), portal klienta `/c/:token`, `firstName`/`lastName` + personalizacja maili
- [x] Globalna wyszukiwarka (`services/search.service.js`, `/admin/search`, pole w nagłówku) — klienci/projekty/transfery (też po imieniu/nazwisku)
- [x] Więcej układów stron klienta (showcase/panel/panel-bg/sidebar/corner/hero-card/minimal/banner) + sticky header + typografia + gotowe motywy; dark mode (klasa, auto-kontrast)
- [x] Uczciwe placeholdery e-mail per-pole (`mail.PLACEHOLDER_SUPPORT`); osobny kolor paska nagłówka panelu (`colors.adminHeader`)
- [x] Podgląd linku OG/meta + własny obraz OG (`Settings.ogImagePath`); „klient otworzył link" (`Event(type:viewed)` na `/t` i `/p`); kod QR linku (inline SVG, `utils/qr.js`)
- [x] Miniatury obrazów + Quick Look (lightbox) w panelu transferu (`/admin/transfers/:id/preview/:fileId`); fix migania gradientu tła za kartą „szkło" (warstwa odsłaniana po `onload`)
- [x] Wiadomości klient↔agencja (dwukierunkowo): koperta + wątek (popup) na `/p`/`/t`/`/c` + badge nowej odpowiedzi; panel = widok wątków (grupowanie po kontekście) + odpowiedź + mail; model `Message`
- [x] Ostrzeżenie o wygasaniu transferu — mail do agencji o wychodzących wygasających <24 h, niepobranych (cron `reminders`, toggle `emails.expiryWarn`, anty-powtórka `Transfer.expiryWarnedAt`)
- [ ] Do zrobienia: testy `node:test`; dane do przelewu na stronie rozliczeń klienta; (odłożone) white-label per-klient

## Workflow Git
Nie pushować automatycznie. Bump wersji + wpis w changelogu dopiero po potwierdzeniu. W komunikatach/URL-ach redagować token dostępowy.
