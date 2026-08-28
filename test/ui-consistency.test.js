// Spójność pól i przycisków w panelu.
//
// DLACZEGO TEST: przed ujednoliceniem w widokach panelu było 47 różnych wariantów przycisku
// głównego, 17 wtórnego i 48 zestawów klas na polach — stąd „brak konsekwencji", najbardziej
// widoczny na telefonie. Ten test pilnuje, żeby nowe ekrany nie zaczęły znowu kleić klas
// ad hoc: wygląd ma pochodzić z warstwy komponentów (.btn / .field), a nie z widoku.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

function viewFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? viewFiles(p) : (e.name.endsWith('.ejs') ? [p] : []);
  });
}

test('widoki panelu nie sklejają własnych przycisków ani pól', () => {
  const offenders = { przycisk: [], pole: [] };
  const uniq = (a) => [...new Set(a)];
  for (const f of viewFiles('src/views/admin')) {
    const src = fs.readFileSync(f, 'utf8');
    // Sygnatury dawnych wariantów. UWAGA: pierwsza wersja tego testu sprawdzała TYLKO
    // `hover:bg-slate-50` i pola z pierścieniem focusu — a część przycisków miała
    // `hover:bg-brand-50`, a część pól nie miała focusu w ogóle, więc przeszły niezauważone
    // i ekrany dalej wyglądały niespójnie. Stąd szersze wzorce.
    if (/bg-brand-600 hover:bg-brand-700/.test(src)) offenders.przycisk.push(f);
    if (/rounded-lg border border-slate-300[^"']*hover:bg-(slate|brand|red)-50/.test(src)) offenders.przycisk.push(f);
    if (/focus:border-brand-500 focus:ring-2/.test(src)) offenders.pole.push(f);
    // Pole to <input|select|textarea> z ramką — bez `field` nie ma spójnej wysokości ani focusu.
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*class="([^"]*)"/g)) {
      const cls = m[2];
      if (/rounded-lg border border-slate-300/.test(cls) && !/\bfield\b/.test(cls)) offenders.pole.push(f);
    }
  }
  assert.deepEqual(uniq(offenders.przycisk), [], 'przycisk: użyj .btn + .btn-primary/.btn-secondary/.btn-danger');
  assert.deepEqual(uniq(offenders.pole), [], 'pole: użyj .field (+ .field-sm)');
});

test('warstwa komponentów jest w zbudowanym CSS (produkcja nie buduje Tailwinda)', () => {
  const css = fs.readFileSync('public/css/app.css', 'utf8');
  for (const cls of ['.btn', '.btn-primary', '.btn-secondary', '.btn-danger', '.btn-icon',
                     '.btn-lg', '.btn-sm', '.field', '.field-sm', '.actions', '.form-row',
                     '.alert', '.alert-error', '.alert-ok', '.chip', '.label']) {
    assert.ok(css.includes(cls + '{') || css.includes(cls + ' '), `brak ${cls} w app.css — zrób npm run build:css`);
  }
  // Obszar dotyku na telefonie: 32 px to za mało na palec.
  assert.match(css, /\.btn-icon\{min-width:2\.75rem;min-height:2\.75rem\}/, 'reguła mobilna dla .btn-icon');
});

test('definicja komponentów żyje w JEDNYM miejscu', () => {
  const input = fs.readFileSync('src/assets/css/input.css', 'utf8');
  assert.match(input, /@layer components/);
  assert.match(input, /\.btn-primary \{ @apply bg-brand-600/);
  assert.match(input, /\.field \{/);
});
