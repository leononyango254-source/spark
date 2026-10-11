import { loadEnv } from "./env";
import { buildDb } from "./db";
import { buildServer } from "./server";

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the API");
}

const app = buildServer({
  db: buildDb(env.DATABASE_URL),
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  nodeEnv: env.NODE_ENV,
});

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => app.log.info(`spark-api listening on ${address}`))
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });