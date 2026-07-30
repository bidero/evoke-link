// Paleta wyszukiwania (Cmd/Ctrl+K) jako GOTOWY HTML dla layoutu panelu.
//
// GOTCHA (dlaczego nie `include`): layout `layouts/admin.ejs` NIE MOŻE używać `include()`,
// bo część widoków panelu renderuje locala o nazwie `client` (skrzynka, kartoteka, edycja
// klienta) — Express kopiuje `client` z locals do opcji kompilatora EJS, co przełącza
// szablon w tryb client-side i `include` przestaje istnieć („include is not a function").
// Dlatego markup partiala renderujemy tutaj do stringa i wstawiamy przez `<%- %>`.
//
// Treść jest statyczna (zależy tylko od ikon), więc w produkcji renderujemy RAZ;
// w dev czytamy plik za każdym razem, żeby zmiana w EJS była widoczna po odświeżeniu.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { icon } = require('./icons');

const FILE = path.join(__dirname, '..', 'views', 'admin', '_search_palette.ejs');
let cached = null;

function html() {
  if (cached !== null) return cached;
  const out = ejs.render(fs.readFileSync(FILE, 'utf8'), { icon }, { filename: FILE });
  if (process.env.NODE_ENV === 'production') cached = out;
  return out;
}

module.exports = { html };
