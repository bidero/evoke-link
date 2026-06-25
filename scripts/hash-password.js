// Generuje bcrypt-hash hasła do wklejenia w ADMIN_PASSWORD_HASH w .env.
// Użycie:  npm run hash -- "twoje-haslo"
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Podaj hasło, np.:  npm run hash -- "moje-haslo"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
console.log('Wklej powyższą linię do .env i wyczyść ADMIN_PASSWORD.');
