# Evoke LINK

Prywatny system wymiany plików między agencją a klientami — prostszy, „agencyjny" WeTransfer.
Działa w dwóch kierunkach: **agencja → klient** (link do pobrania) oraz **klient → agencja**
(formularz uploadu). Wszystko grupowane w **Projektach**.

Stos: **Node.js + Express**, **SQLite** (przez Prisma), szablony **EJS + Tailwind + Alpine.js**.

## Funkcje
- 📤 **Transfery wychodzące** — wyślij pliki/folder, link `/t/:token`, hasło, data wygaśnięcia, limit pobrań, pobieranie pojedyncze lub ZIP.
- 🧩 **Upload dużych plików (chunked, równoległy)** — pliki dzielone na kawałki po stronie przeglądarki i wysyłane współbieżnie (omija limity rozmiaru requestu hostingu współdzielonego); działa we wszystkich uploadach (panel, `/upload`, panel klienta).
- 🖼️ **Warianty wyglądu stron klienta** — układ (klasyczny / karta na tle / hero + karta), styl karty (biel / mrożone szkło / uniesiona), zaokrąglenie rogów, kształt przycisku, branding strony logowania — wszystko z panelu.
- 📥 **Uploady przychodzące** — link `/upload/:token`, klient wgrywa pliki, agencja dostaje e-mail i powiadomienie.
- 📁 **Projekty** — grupują transfery (wysłane i odebrane) oraz pełną historię zdarzeń.
- 👤 **Panel klienta** — link `/p/:token` z plikami widocznymi dla klienta (pobieranie + upload), opcjonalne hasło.
- 📝 **Link onboardingowy** — jednorazowy formularz `/onboard/:token` (ważny 7 dni), przez który nowy klient sam uzupełnia dane do współpracy i rozliczeń (firma, NIP, adres, kontakt); agencja dostaje powiadomienie i e-mail.
- 🔔 **Dashboard i powiadomienia** — aktywne transfery, miejsce na dysku, dzwonek z licznikiem nieprzeczytanych.
- 🧱 **Konfigurowalny panel** — widżety pulpitu przestawiane drag&drop bezpośrednio na pulpicie (statystyki, zadania z kalendarza, przychód + top klienci, nieprzeczytane wiadomości) z regulowaną szerokością (¼/⅓/½/⅔/pełna) i ukrywaniem; menu boczne z ikonami: własna kolejność, ukrywanie i nazwy pozycji.
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
   npm install                # instaluje też prisma (CLI) — migracje na produkcji
   npm run prisma:deploy      # zakłada/aktualizuje bazę bez pytań interaktywnych
   ```
   > CSS (`public/css/app.css`) jest **w repo** — na produkcji NIE budujemy Tailwinda.
   > `npm run build:css` uruchamiamy lokalnie po zmianie stylów i commitujemy wynik.
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

### Backup danych (cron)
Spójna kopia bazy (`VACUUM INTO`) + pliki transferów spakowane ZIP-em do `backups/` (poza repo), z rotacją:
```
30 3 * * *  cd ~/domains/transfer.twojadomena.pl/app && node src/jobs/backup.job.js
```
Konfiguracja w `.env`: `BACKUP_DIR` (domyślnie `./backups`), `BACKUP_KEEP` (domyślnie 14). Odtworzenie = rozpakuj wybrany ZIP: `evoke.db` → `storage/`, `transfers/` → `storage/transfers/`.
Z panelu (Ustawienia → Zaawansowane): ręczne pobranie kopii (ZIP, zakres: baza / baza+pliki) oraz włączanie/wyłączanie automatycznego backupu (gdy wyłączony, cron pomija wykonanie).

### Przypomnienia o płatności (cron)
Maile do klientów o przeterminowanych pozycjach (wymaga włączenia w Ustawieniach → E-mail oraz działającego SMTP):
```
0 8 * * *  cd ~/domains/transfer.twojadomena.pl/app && node src/jobs/reminders.job.js
```
Anty-spam: jeden klient nie częściej niż co `REMIND_EVERY_DAYS` (`.env`, domyślnie 7 dni).

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
- [x] **Chunked upload** — dzielenie dużych plików na 5 MB (równoległe, panel + `/upload` + portal), drop-in z fallbackiem multipart
- [x] **CRM + rozliczenia** — baza klientów, strona 360°, portal klienta `/c/:token`, pozycje rozliczeniowe (CSV + PDF + wysyłka), przypomnienia o płatności (cron)
- [x] **Wyszukiwarka globalna** — klienci / projekty / transfery (pole w nagłówku panelu)
- [x] **Więcej wyglądu** — dodatkowe układy stron klienta, sticky header, typografia, gotowe motywy, dark mode
- [x] **Podgląd linku** — meta OpenGraph + własny obraz OG; „klient otworzył link" w osi czasu; kod QR linku
- [x] **Panel: miniatury + Quick Look** — podgląd obrazów w liście plików transferu (lightbox jak na Macu); osobny kolor paska nagłówka panelu
- [x] **Wiadomości** — dwukierunkowa rozmowa klient↔agencja (koperta + wątek na stronach klienta, badge nowej odpowiedzi; skrzynka wątków w panelu)
- [x] **Ostrzeżenie o wygasaniu** — mail do agencji o transferach wygasających w 24 h, których klient nie pobrał (cron, przełącznik w Ustawieniach)
- [x] **Testy** — `npm test` (node:test): smoke + przepływ wiadomości + ostrzeżenie o wygasaniu
- [x] **Kalendarz** — menedżer zadań: siatka miesiąca + nadchodzące, przypomnienia ze statusem/priorytetem, agregacja terminów płatności i wygasania transferów
- [x] **Automatyzacja** — „otworzył link" na wszystkich stronach klienta; „Przedłuż transfer" jednym kliknięciem; opcjonalne dzienne podsumowanie mailem do agencji
- [x] **Puls agencji** — analityka: przychód (wykres 6 mies.), należności, skuteczność pobrań, aktywni i top klienci
- [x] **Kanban + drag&drop** — tablica projektów (Lead → Aktywny → Dostarczony → Zapłacony) i przeciąganie terminów przypomnień w kalendarzu
- [x] **Proofing** — akceptacja plików przez klienta: Zatwierdzam / Zgłaszam poprawki (+komentarz) na stronie pobierania i w panelu projektu; status w panelu agencji + powiadomienie i mail
- [x] **Lista braków** — checklista materiałów od klienta (np. logo, teksty, zdjęcia); klient widzi ją w panelu, a wysyłając pliki wskazuje punkt, który odhacza się sam
- [x] **Link onboardingowy** — jednorazowy formularz, przez który nowy klient sam uzupełnia dane do współpracy i rozliczeń
- [x] **Konfigurowalny panel** — pulpit z widżetami (drag&drop, ukrywanie, nowe widżety: zadania / przychód / wiadomości) i edytowalne menu boczne z ikonami
