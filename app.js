// Punkt startowy aplikacji (Application Startup File dla Passengera na SeoHost/DirectAdmin).
// Passenger sam ustawia process.env.PORT i uruchamia ten plik.
const app = require('./src/app');
const config = require('./src/config');

const server = app.listen(config.port, () => {
  console.log(`Evoke Transfer działa na porcie ${config.port} (${config.env})`);
});

// Łagodne zamknięcie przy restarcie.
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
