// Ustawia/zmienia hasło administratora z linii poleceń (zapis do bazy, tabela User).
// Ratunek, gdy zapomnisz hasła ustawionego w panelu (/admin/account).
//
// Użycie:
//   npm run set-password -- "nowe-haslo"     ustaw nowe hasło (min. 8 znaków)
//   npm run set-password -- --clear          usuń hasło z bazy → logowanie wraca do .env
const config = require('../src/config');
const prisma = require('../src/db/client');
const { setAdminPassword } = require('../src/services/auth.service');

(async () => {
  const arg = process.argv[2];
  const email = (config.admin.email || '').trim().toLowerCase();
  if (!email) {
    console.error('Brak ADMIN_EMAIL w .env — nie wiem, dla kogo ustawić hasło.');
    process.exit(1);
  }

  if (arg === '--clear') {
    const r = await prisma.user.deleteMany({ where: { email } });
    console.log(
      r.count
        ? `Usunięto hasło z bazy dla ${email}. Logowanie korzysta teraz z ADMIN_PASSWORD/HASH z .env.`
        : `Brak hasła w bazie dla ${email} — logowanie i tak korzysta z .env.`
    );
    process.exit(0);
  }

  if (!arg || arg.length < 8) {
    console.error('Użycie:');
    console.error('  npm run set-password -- "nowe-haslo"   (min. 8 znaków)');
    console.error('  npm run set-password -- --clear        (powrót do hasła z .env)');
    process.exit(1);
  }

  await setAdminPassword(arg);
  console.log(`Ustawiono nowe hasło administratora (${email}) w bazie. Zaloguj się nim w /admin/login.`);
  process.exit(0);
})().catch((e) => {
  console.error('Błąd:', e.message);
  process.exit(1);
});
