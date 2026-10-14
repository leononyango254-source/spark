import { handleMessage, type MessageEnv } from "@spark/bot/message";
import type { TelegramUpdate } from "@spark/telegram";
import type { FastifyInstance } from "fastify";
import type { ApiDeps } from "../server";

export function registerTelegramWebhookRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post("/api/telegram/webhook", async (request, reply) => {
    const cfg = deps.telegramWebhook;
    if (!cfg || !deps.telegram) {
      return reply.code(503).send({ error: "telegram_not_configured" });
    }
    const provided = request.headers["x-telegram-bot-api-secret-token"];
    if (provided !== cfg.secret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const messageEnv: MessageEnv = {
      webappUrl: cfg.webappUrl,
      appName: deps.appName,
      botUsername: deps.botUsername,
      apiOrigin: "",
      apiToken: "",
    };
    try {
      await handleMessage(deps.telegram, messageEnv, request.body as TelegramUpdate);
    } catch {
      // Never fail webhook delivery on handler errors; Telegram would retry.
    }
    return reply.code(200).send({ ok: true });
  });
}
