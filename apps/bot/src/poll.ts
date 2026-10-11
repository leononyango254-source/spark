import type { TelegramBotApi, TelegramUpdate } from "@spark/telegram";

export interface PollOptions {
  client: Pick<TelegramBotApi, "getMe" | "getUpdates">;
  handler: (update: TelegramUpdate) => Promise<void>;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export async function runBot(opts: PollOptions): Promise<void> {
  let offset = 0;
  const timeout = opts.timeoutSeconds ?? 30;
  for (;;) {
    if (opts.signal?.aborted) return;
    let updates: TelegramUpdate[];
    try {
      updates = await opts.client.getUpdates({ offset, timeout });
    } catch (err) {
      console.error("[poll] getUpdates failed:", err);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const update of updates) {
      try {
        await opts.handler(update);
      } catch (err) {
        console.error("[poll] handler failed:", err);
      }
      offset = Math.max(offset, update.update_id + 1);
    }
    if (updates.length === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }
}
