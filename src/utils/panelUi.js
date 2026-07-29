// Konfigurowalny panel admina: kanoniczne listy pozycji menu i widżetów pulpitu
// + scalanie z zapisaną konfiguracją (Settings.panel JSON).
// Zapis trzyma tylko delty: { menu: [{key,hidden,label}], dashboard: [{key,hidden}] } w kolejności.
// Scalanie = unia: zapisana kolejność najpierw, nieznane klucze odrzucane,
// brakujące (nowe pozycje po aktualizacji aplikacji) doklejane na końcu jako widoczne.

// Menu boczne. Badge'y (notifications/messages/calendar) są wpięte po `key` w layoucie.
const MENU = [
  { key: 'dashboard', label: 'Pulpit', href: '/admin', icon: 'home' },
  { key: 'pulse', label: 'Puls agencji', href: '/admin/pulse', icon: 'activity' },
  { key: 'sales', label: 'Sprzedaż', href: '/admin/sales', icon: 'funnel' },
  { key: 'calendar', label: 'Kalendarz', href: '/admin/calendar', icon: 'calendarDays' },
  { key: 'tasks', label: 'Zadania', href: '/admin/tasks', icon: 'check' },
  { key: 'projects', label: 'Projekty', href: '/admin/projects', icon: 'folder' },
  { key: 'clients', label: 'Klienci', href: '/admin/clients', icon: 'users' },
  { key: 'transfers', label: 'Transfery', href: '/admin/transfers', icon: 'send' },
  { key: 'messages', label: 'Wiadomości', href: '/admin/messages', icon: 'mail' },
  { key: 'notifications', label: 'Powiadomienia', href: '/admin/notifications', icon: 'bell' },
  { key: 'settings', label: 'Ustawienia', href: '/admin/settings', icon: 'cog' },
];

// Widżety pulpitu. span = szerokość na lg w jednostkach siatki 12-kolumnowej
// (3 = ¼, 4 = ⅓, 6 = ½, 8 = ⅔, 12 = pełna); rows = WYSOKOŚĆ w jednostkach siatki
// (`auto-rows-[96px]` + gap 20px → 2=212px, 3=328px, 4=444px, 6=676px). Obie wartości
// użytkownik zmienia przełącznikami w trybie edycji pulpitu.
// Dzięki `rows` da się złożyć układ „dwa niskie kafelki obok jednego wysokiego" —
// CSS Grid sam pakuje elementy w kolumnach (auto-placement wg kolejności DOM).
// Renderery: views/admin/_widgets/<key>.ejs.
const SPANS = [3, 4, 6, 8, 12];
const ROWS = [2, 3, 4, 6];
const WIDGETS = [
  { key: 'stat-transfers', label: 'Aktywne transfery', span: 4, rows: 2, icon: 'send' },
  { key: 'stat-projects', label: 'Aktywne projekty', span: 4, rows: 2, icon: 'folder' },
  { key: 'stat-uploads', label: 'Oczekujące uploady', span: 4, rows: 2, icon: 'cloudUpload' },
  { key: 'stat-outstanding', label: 'Do rozliczenia', span: 4, rows: 2, icon: 'banknote' },
  { key: 'stat-overdue', label: 'Przeterminowane', span: 4, rows: 2, icon: 'clock' },
  { key: 'stat-storage', label: 'Wykorzystane miejsce', span: 4, rows: 2, icon: 'archive' },
  { key: 'actions', label: 'Szybkie akcje', span: 4, rows: 4, icon: 'plus' },
  { key: 'activity', label: 'Ostatnia aktywność', span: 8, rows: 4, icon: 'activity' },
  { key: 'tasks', label: 'Nadchodzące zadania', span: 4, rows: 4, icon: 'calendarDays' },
  { key: 'revenue', label: 'Przychód i top klienci', span: 4, rows: 4, icon: 'trendingUp' },
  { key: 'messages', label: 'Nieprzeczytane wiadomości', span: 4, rows: 4, icon: 'mail' },
  { key: 'followup', label: 'Do odezwania się', span: 4, rows: 4, icon: 'phone' },
];

// Szybkie akcje (widżet pulpitu „Szybkie akcje"). `on` = domyślnie widoczna.
// `primary` = wyróżniony przycisk (brand). Konfiguracja: Settings.panel.actions (delty hidden).
const ACTIONS = [
  { key: 'transfer', label: 'Wyślij pliki klientowi', href: '/admin/transfers/new', icon: 'send', primary: true, on: true },
  { key: 'upload', label: 'Utwórz link uploadu', href: '/admin/transfers/new-upload', icon: 'cloudUpload', on: true },
  { key: 'project', label: 'Nowy projekt', href: '/admin/projects/new', icon: 'folder', on: true },
  { key: 'client', label: 'Nowy klient', href: '/admin/clients/new', icon: 'users', on: true },
  { key: 'calendar', label: 'Kalendarz / zadanie', href: '/admin/calendar', icon: 'calendarDays', on: false },
  { key: 'tasks', label: 'Zadania (kanban)', href: '/admin/tasks', icon: 'check', on: false },
  { key: 'sales', label: 'Sprzedaż i oferty', href: '/admin/sales', icon: 'funnel', on: false },
  { key: 'messages', label: 'Wiadomości', href: '/admin/messages', icon: 'mail', on: false },
  { key: 'board', label: 'Tablica projektów', href: '/admin/projects/board', icon: 'grip', on: false },
  { key: 'templates', label: 'Szablony projektów', href: '/admin/projects/templates', icon: 'copy', on: false },
  { key: 'pulse', label: 'Puls agencji', href: '/admin/pulse', icon: 'activity', on: false },
];

const MENU_KEYS = MENU.map((m) => m.key);
const WIDGET_KEYS = WIDGETS.map((w) => w.key);
const ACTION_KEYS = ACTIONS.map((a) => a.key);

// Scala zapisaną konfigurację z listą kanoniczną. Zwraca pełne pozycje w docelowej
// kolejności z flagą hidden; „Ustawienia" zawsze widoczne (droga powrotna).
function mergeMenu(cfg) {
  const saved = Array.isArray(cfg) ? cfg : [];
  const byKey = Object.fromEntries(MENU.map((m) => [m.key, m]));
  const out = [];
  const seen = new Set();
  for (const s of saved) {
    const base = s && byKey[s.key];
    if (!base || seen.has(s.key)) continue;
    seen.add(s.key);
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 30) : base.label;
    out.push({ ...base, label, defaultLabel: base.label, hidden: s.key === 'settings' ? false : !!s.hidden });
  }
  for (const m of MENU) if (!seen.has(m.key)) out.push({ ...m, defaultLabel: m.label, hidden: false });
  return out;
}

function mergeWidgets(cfg) {
  const saved = Array.isArray(cfg) ? cfg : [];
  const byKey = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));
  const out = [];
  const seen = new Set();
  for (const s of saved) {
    const base = s && byKey[s.key];
    if (!base || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({
      ...base,
      hidden: !!s.hidden,
      span: SPANS.includes(s.span) ? s.span : base.span,
      rows: ROWS.includes(s.rows) ? s.rows : base.rows,
    });
  }
  for (const w of WIDGETS) if (!seen.has(w.key)) out.push({ ...w, hidden: false });
  return out;
}

// Czyszczenie przed zapisem (whitelist kluczy, przycięte etykiety, boole).
function sanitizeMenu(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || !MENU_KEYS.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    const custom = typeof s.label === 'string' ? s.label.trim().slice(0, 30) : '';
    const def = MENU.find((m) => m.key === s.key).label;
    out.push({ key: s.key, hidden: s.key === 'settings' ? false : !!s.hidden, ...(custom && custom !== def ? { label: custom } : {}) });
  }
  return out;
}

function sanitizeWidgets(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || !WIDGET_KEYS.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    const span = Number(s.span);
    const rows = Number(s.rows);
    out.push({
      key: s.key,
      hidden: !!s.hidden,
      ...(SPANS.includes(span) ? { span } : {}),
      ...(ROWS.includes(rows) ? { rows } : {}),
    });
  }
  return out;
}

// Szybkie akcje: pełna lista z flagą hidden (kolejność rejestru). Domyślnie widoczne = `on`.
function mergeActions(cfg) {
  const saved = Array.isArray(cfg) ? cfg : [];
  const byKey = Object.fromEntries(saved.filter((s) => s && s.key).map((s) => [s.key, s]));
  return ACTIONS.map((a) => {
    const s = byKey[a.key];
    return { ...a, hidden: s ? !!s.hidden : !a.on };
  });
}

function sanitizeActions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || !ACTION_KEYS.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, hidden: !!s.hidden });
  }
  return out;
}

module.exports = { MENU, WIDGETS, ACTIONS, SPANS, ROWS, mergeMenu, mergeWidgets, mergeActions, sanitizeMenu, sanitizeWidgets, sanitizeActions };
