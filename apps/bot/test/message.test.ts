import {
  buildCampaignDeepLink,
  buildStartapp,
  TelegramBotClient,
  type TelegramUpdate,
} from "@spark/telegram";
import { describe, expect, it, vi } from "vitest";
import { handleMessage, type MessageEnv } from "../src/message";

function createFakeClient(): TelegramBotClient {
  return new TelegramBotClient({
    botToken: "TEST_TOKEN",
    fetchImpl: vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    ),
  });
}

function makeUpdate(text: string, chatId: number = 42): TelegramUpdate {
  return { update_id: 1, message: { chat: { id: chatId }, text } };
}

function makeUpdateNoChat(text: string): TelegramUpdate {
  return { update_id: 1, message: { text, chat: { id: 0 } } };
}

const testEnv: MessageEnv = {
  webappUrl: "https://web.example.com",
  appName: "appname",
  botUsername: "botname",
  apiOrigin: "https://api.example.com",
  apiToken: "test-api-token",
};

vi.stubGlobal(
  "fetch",
  vi.fn(
    async () =>
      new Response(JSON.stringify({ deepLink: "https://t.me/join?deep=refcode1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ),
);

describe("handleMessage", () => {
  it("ignores non-/start messages", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    await handleMessage(client, testEnv, makeUpdate("hello"));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("replies with deep link for /start with payload", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    const payload = buildStartapp("publicid12345678", "refcode1");
    const expectedUrl = buildCampaignDeepLink("botname", "appname", payload);
    await handleMessage(client, testEnv, makeUpdate(`/start ${payload}`));
    expect(sendSpy).toHaveBeenCalledOnce();
    const calls = sendSpy.mock.calls;
    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (call) {
      const [chatId, text, opts] = call;
      expect(chatId).toBe("42");
      expect(text).toBe("Open your campaign:");
      const keyboard = opts?.replyMarkup?.inlineKeyboard;
      expect(keyboard).toBeDefined();
      if (keyboard?.[0]?.[0]) {
        expect(keyboard[0][0].url).toBe(expectedUrl);
        expect(keyboard[0][0].text).toBe("Open Spark");
      }
    }
  });

  it("replies with webapp URL for /start without payload", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    await handleMessage(client, testEnv, makeUpdate("/start"));
    expect(sendSpy).toHaveBeenCalledOnce();
    const calls = sendSpy.mock.calls;
    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (call) {
      const [chatId, text, opts] = call;
      expect(chatId).toBe("42");
      expect(text).toBe("Open Spark:");
      const keyboard = opts?.replyMarkup?.inlineKeyboard;
      expect(keyboard).toBeDefined();
      if (keyboard?.[0]?.[0]) {
        expect(keyboard[0][0].url).toBe("https://web.example.com");
        expect(keyboard[0][0].text).toBe("Open Spark");
      }
    }
  });

  it("ignores message without chat.id", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    await handleMessage(client, testEnv, makeUpdateNoChat("/start payload"));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("ignores /start with invalid payload format", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    await handleMessage(client, testEnv, makeUpdate("/start invalid_payload_format"));
    expect(sendSpy).toHaveBeenCalledOnce();
    const calls = sendSpy.mock.calls;
    expect(calls.length).toBe(1);
    const call = calls[0];
    if (call) {
      const [chatId, text, opts] = call;
      expect(chatId).toBe("42");
      expect(text).toBe("Open Spark:");
      const keyboard = opts?.replyMarkup?.inlineKeyboard;
      if (keyboard?.[0]?.[0]) {
        expect(keyboard[0][0].url).toBe("https://web.example.com");
      }
    }
  });

  it("ignores whitespace-only text", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    await handleMessage(client, testEnv, makeUpdate("   "));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("fetches referral link and sends it for /share", async () => {
    const client = createFakeClient();
    const sendSpy = vi.spyOn(client, "sendMessage");
    const publicId = "publicid12345678";
    const code = "refcode1";
    await handleMessage(client, testEnv, makeUpdate(`/share ${publicId}_${code}`));
    expect(sendSpy).toHaveBeenCalledOnce();
    const calls = sendSpy.mock.calls;
    expect(calls.length).toBe(1);
    const call = calls[0];
    if (call) {
      const [chatId, text, opts] = call;
      expect(chatId).toBe("42");
      expect(text).toContain(`c_${publicId}_${code}`);
      const keyboard = opts?.replyMarkup?.inlineKeyboard;
      expect(keyboard).toBeDefined();
      if (keyboard?.[0]?.[0]) {
        expect(keyboard[0][0].text).toBe("Share");
      }
    }
  });
});
