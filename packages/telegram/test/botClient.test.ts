import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatMember, TelegramApiError, TelegramBotClient } from "../src";

const TOKEN = "123456:TEST_BOT_TOKEN";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TelegramBotClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getChatMember returns the parsed ChatMember", async () => {
    const member: ChatMember = { status: "member" };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true, result: member }));
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    const got = await client.getChatMember(-1001234n, 4242n);
    expect(got).toEqual(member);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/getChatMember`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ chat_id: "-1001234", user_id: "4242" });
  });

  it("throws TelegramApiError when the API reports ok:false", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, error_code: 400, description: "Bad Request: chat not found" }),
    );
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    await expect(client.getChatMember(1n, 2n)).rejects.toBeInstanceOf(TelegramApiError);
    await expect(client.getChatMember(1n, 2n)).rejects.toMatchObject({ code: 400 });
  });

  it("exposes botToken and sends messages with an inline keyboard", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true, result: true }));
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    expect(client.botToken).toBe(TOKEN);
    await client.sendMessage(42n, "hello", {
      replyMarkup: { inlineKeyboard: [[{ text: "Open", url: "https://t.me/x/y" }]] },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).endsWith("/sendMessage")).toBe(true);
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe("hello");
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe("https://t.me/x/y");
  });
});
