import { TelegramBotClient, type TelegramUpdate } from "@spark/telegram";
import { describe, expect, it, vi } from "vitest";
import { runBot } from "../src/poll";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createFakeClient(
  updates: TelegramUpdate[][],
): Pick<TelegramBotClient, "getMe" | "getUpdates"> {
  let callIndex = 0;
  const client = new TelegramBotClient({
    botToken: "TEST_TOKEN",
    fetchImpl: vi.fn(async () => jsonResponse({ ok: true, result: updates[callIndex++] ?? [] })),
  });
  return { getUpdates: client.getUpdates.bind(client), getMe: client.getMe.bind(client) };
}

describe("runBot (poll)", () => {
  it("processes updates in order and advances offset", async () => {
    const updates = [
      [{ update_id: 1, message: { chat: { id: 1 }, text: "/start" } }],
      [{ update_id: 2, message: { chat: { id: 2 }, text: "hello" } }],
      [],
    ];
    const client = createFakeClient(updates);
    const handled: TelegramUpdate[] = [];
    let pollCount = 0;
    const controller = new AbortController();
    const promise = runBot({
      client,
      handler: async (u) => {
        handled.push(u);
      },
      timeoutSeconds: 0,
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        pollCount++;
        if (pollCount >= 3) {
          controller.abort();
          resolve();
        } else {
          setImmediate(check);
        }
      };
      setImmediate(check);
    });
    await promise;
    expect(handled.map((u) => u.update_id)).toEqual([1, 2]);
  });

  it("stops when signal is aborted before first poll", async () => {
    const client = createFakeClient([[{ update_id: 1 }]]);
    const controller = new AbortController();
    controller.abort();
    const handled: TelegramUpdate[] = [];
    await runBot({
      client,
      handler: async (u) => {
        handled.push(u);
      },
      timeoutSeconds: 0,
      signal: controller.signal,
    });
    expect(handled).toHaveLength(0);
  });
});
