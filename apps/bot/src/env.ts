import { z } from "zod";

export const botEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBAPP_URL: z.string().url(),
  TELEGRAM_APP_NAME: z.string().min(1),
  API_BOT_POLL_TIMEOUT: z.coerce.number().int().positive().default(30),
});

export type BotEnv = z.infer<typeof botEnvSchema>;

export function loadBotEnv(): BotEnv {
  return botEnvSchema.parse(process.env);
}
