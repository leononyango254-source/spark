import { TelegramBotClient } from "@spark/telegram";
import { loadBotEnv } from "./env";
import { handleMessage, type MessageEnv } from "./message";
import { runBot } from "./poll";

async function main(): Promise<void> {
  const env = loadBotEnv();
  const client = new TelegramBotClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const me = await client.getMe();
  console.log(`Bot @${me.username} started`);

  const messageEnv: MessageEnv = {
    webappUrl: env.TELEGRAM_WEBAPP_URL,
    appName: env.TELEGRAM_APP_NAME,
    botUsername: me.username,
    apiOrigin: env.API_ORIGIN ?? "",
    apiToken: env.BOT_API_TOKEN ?? "",
  };

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());

  await runBot({
    client,
    handler: (update) => handleMessage(client, messageEnv, update),
    timeoutSeconds: env.API_BOT_POLL_TIMEOUT,
    signal: controller.signal,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
