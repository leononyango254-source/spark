import type { ChatMember } from "./membership";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

export interface InlineKeyboardButton {
  text: string;
  url: string;
}

export interface TelegramBotApi {
  readonly botToken: string;
  getChatMember(chatId: bigint | string, telegramUserId: bigint): Promise<ChatMember>;
  getChatAdministrators(chatId: bigint | string): Promise<ChatMember[]>;
  sendMessage(
    chatId: bigint | string,
    text: string,
    opts?: { replyMarkup?: { inlineKeyboard: InlineKeyboardButton[][] } },
  ): Promise<void>;
  getMe(): Promise<{ id: number; username: string }>;
  getUpdates(opts: { offset: number; timeout: number }): Promise<TelegramUpdate[]>;
  setWebhook(opts: { url: string; secretToken: string }): Promise<void>;
  deleteWebhook(): Promise<void>;
  setChatMenuButton(opts: { webAppUrl: string; text?: string }): Promise<void>;
}

export interface TelegramBotClientOptions {
  botToken: string;
  fetchImpl?: typeof fetch;
}

export class TelegramApiError extends Error {
  readonly code: number;
  readonly description: string;

  constructor(code: number, description: string) {
    super(`Telegram API ${code}: ${description}`);
    this.code = code;
    this.description = description;
  }
}

export class TelegramBotClient implements TelegramBotApi {
  readonly botToken: string;
  readonly #fetch: typeof fetch;

  constructor(opts: TelegramBotClientOptions) {
    this.botToken = opts.botToken;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  #url(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  async #call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(this.#url(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new TelegramApiError(0, `network error calling ${method}`);
    }
    if (!res.ok) {
      throw new TelegramApiError(res.status, `HTTP ${res.status}`);
    }
    let body: { ok: boolean; result?: T; error_code?: number; description?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TelegramApiError(res.status, "invalid JSON response");
    }
    if (!body.ok) {
      throw new TelegramApiError(body.error_code ?? 0, body.description ?? "unknown error");
    }
    return body.result as T;
  }

  async getChatMember(chatId: bigint | string, telegramUserId: bigint): Promise<ChatMember> {
    return this.#call<ChatMember>("getChatMember", {
      chat_id: chatId.toString(),
      user_id: telegramUserId.toString(),
    });
  }

  async getChatAdministrators(chatId: bigint | string): Promise<ChatMember[]> {
    return this.#call<ChatMember[]>("getChatAdministrators", { chat_id: chatId.toString() });
  }

  async sendMessage(
    chatId: bigint | string,
    text: string,
    opts?: { replyMarkup?: { inlineKeyboard: InlineKeyboardButton[][] } },
  ): Promise<void> {
    const payload: Record<string, unknown> = { chat_id: chatId.toString(), text };
    if (opts?.replyMarkup) {
      payload.reply_markup = { inline_keyboard: opts.replyMarkup.inlineKeyboard };
    }
    await this.#call("sendMessage", payload);
  }

  async getMe(): Promise<{ id: number; username: string }> {
    return this.#call<{ id: number; username: string }>("getMe", {});
  }

  async getUpdates(opts: { offset: number; timeout: number }): Promise<TelegramUpdate[]> {
    return this.#call<TelegramUpdate[]>("getUpdates", {
      offset: opts.offset,
      timeout: opts.timeout,
      limit: 100,
      allowed_updates: ["message"],
    });
  }

  async setWebhook(opts: { url: string; secretToken: string }): Promise<void> {
    await this.#call("setWebhook", {
      url: opts.url,
      secret_token: opts.secretToken,
      allowed_updates: ["message"],
    });
  }

  async deleteWebhook(): Promise<void> {
    await this.#call("deleteWebhook", {});
  }

  async setChatMenuButton(opts: { webAppUrl: string; text?: string }): Promise<void> {
    await this.#call("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: opts.text ?? "Open Spark",
        web_app: { url: opts.webAppUrl },
      },
    });
  }
}
