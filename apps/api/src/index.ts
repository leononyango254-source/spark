import { TelegramBotClient } from "@spark/telegram";
import { createMembershipCache } from "./cache/membershipCache";
import { buildDb } from "./db";
import { loadEnv } from "./env";
import { buildServer } from "./server";

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the API");
}

const app = buildServer({
  db: buildDb(env.DATABASE_URL),
  telegram: env.TELEGRAM_BOT_TOKEN
    ? new TelegramBotClient({ botToken: env.TELEGRAM_BOT_TOKEN })
    : undefined,
  membershipCache: createMembershipCache(env.MEMBERSHIP_CACHE_TTL_MS),
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
