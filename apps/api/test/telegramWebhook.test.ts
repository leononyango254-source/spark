import type { TelegramBotApi } from "@spark/telegram";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";

function fakeTelegram() {
  const sendMessage = vi.fn(async () => {});
  const api = {
    botToken: "token",
    sendMessage,
  } as unknown as TelegramBotApi;
  return { api, sendMessage };
}

function buildTestServer(
  telegram: TelegramBotApi | undefined,
  webhook?: { secret: string; webappUrl: string },
) {
  return buildServer({
    db: {} as never,
    telegram,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    botUsername: "testbot",
    appName: "app",
    telegramWebhook: webhook,
  } as never);
}

const UPDATE = { message: { chat: { id: 42 }, text: "/start" } };

describe("telegram webhook", () => {
  it("returns 503 when telegram is not configured", async () => {
    const app = buildTestServer(undefined, { secret: "s", webappUrl: "https://x.test" });
    const res = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      payload: UPDATE,
    });
    expect(res.statusCode).toBe(503);
  });

  it("rejects a missing or wrong secret", async () => {
    const { api } = fakeTelegram();
    const app = buildTestServer(api, { secret: "s", webappUrl: "https://x.test" });
    const res = await app.inject({ method: "POST", url: "/api/telegram/webhook", payload: UPDATE });
    expect(res.statusCode).toBe(401);
  });

  it("dispatches /start to the bot on a valid secret", async () => {
    const { api, sendMessage } = fakeTelegram();
    const app = buildTestServer(api, { secret: "s", webappUrl: "https://x.test" });
    const res = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "s" },
      payload: UPDATE,
    });
    expect(res.statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
