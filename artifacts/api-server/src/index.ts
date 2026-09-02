import app from "./app";
import { logger } from "./lib/logger";

// FIX BUG KRUSIAL (ketemu user — server MATI TOTAL gara-gara EPIPE dari
// subprocess Python backtest): tanpa handler ini, SATU error async yang gak
// ketangkep (di mana pun — bukan cuma backtest) bisa matiin SELURUH server,
// ngefek ke SEMUA user yang lagi pakai app, bukan cuma request yang lagi
// error. Log error-nya, tapi JANGAN exit — biarin server tetep hidup buat
// request lain. (Exception yang genuinely fatal soal state korup tetep bisa
// nyebabin masalah lanjutan, tapi itu resiko yang jauh lebih kecil
// dibanding downtime total buat semua orang.)
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException — server tetap jalan, error di-log doang');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection — server tetap jalan, error di-log doang');
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});