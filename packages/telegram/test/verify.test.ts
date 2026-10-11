import { describe, expect, it } from "vitest";
import {
  type ChatMember,
  isBotAdministrator,
  TelegramApiError,
  type TelegramBotApi,
  verifyChannelMembership,
} from "../src";

class FakeTelegram implements TelegramBotApi {
  readonly botToken = "123456:TEST";
  constructor(
    private readonly member: () => Promise<ChatMember>,
    private readonly me: { id: number; username: string } = { id: 123456, username: "sparkbot" },
  ) {}

  getChatMember(): Promise<ChatMember> {
    return this.member();
  }

  getChatAdministrators(): Promise<ChatMember[]> {
    return Promise.resolve([]);
  }

  sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  getMe(): Promise<{ id: number; username: string }> {
    return Promise.resolve(this.me);
  }

  getUpdates(): Promise<never[]> {
    return Promise.resolve([]);
  }
}

describe("verifyChannelMembership", () => {
  it("accepts creator/administrator/member and restricted with is_member", async () => {
    for (const status of ["creator", "administrator", "member"] as const) {
      const api = new FakeTelegram(async () => ({ status }));
      await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toEqual({
        ok: true,
        memberStatus: status,
      });
    }
    const api = new FakeTelegram(async () => ({ status: "restricted", is_member: true }));
    await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toMatchObject({ ok: true });
  });

  it("rejects left/kicked and restricted without is_member", async () => {
    for (const status of ["left", "kicked"] as const) {
      const api = new FakeTelegram(async () => ({ status }));
      await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toEqual({
        ok: false,
        memberStatus: status,
        reason: "not_member",
      });
    }
    const api = new FakeTelegram(async () => ({ status: "restricted", is_member: false }));
    await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toMatchObject({
      ok: false,
      reason: "not_member",
    });
  });

  it("maps Telegram API errors to a reason, rethrowing non-Telegram failures", async () => {
    const api = new FakeTelegram(async () => {
      throw new TelegramApiError(400, "Bad Request");
    });
    await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toEqual({
      ok: false,
      memberStatus: null,
      reason: "telegram_400",
    });
    await expect(
      verifyChannelMembership(
        new FakeTelegram(async () => Promise.reject(new Error("boom"))),
        -100n,
        1n,
      ),
    ).rejects.toThrow("boom");
  });
});

describe("isBotAdministrator", () => {
  it("is true when the bot is in the administrators list", async () => {
    const api = new FakeTelegram(
      async () => {
        throw new Error("unused");
      },
      { id: 123456, username: "sparkbot" },
    );
    api.getChatAdministrators = async () => [{ user: { id: 123456 }, status: "administrator" }];
    expect(await isBotAdministrator(api, -100n)).toBe(true);
  });

  it("is true when the bot is creator", async () => {
    const api = new FakeTelegram(
      async () => {
        throw new Error("unused");
      },
      { id: 123456, username: "sparkbot" },
    );
    api.getChatAdministrators = async () => [{ user: { id: 123456 }, status: "creator" }];
    expect(await isBotAdministrator(api, -100n)).toBe(true);
  });

  it("is false when the bot is not in the administrators list", async () => {
    const api = new FakeTelegram(
      async () => {
        throw new Error("unused");
      },
      { id: 123456, username: "sparkbot" },
    );
    api.getChatAdministrators = async () => [{ user: { id: 999999 }, status: "administrator" }];
    expect(await isBotAdministrator(api, -100n)).toBe(false);
  });

  it("is false when administrators list is empty", async () => {
    const api = new FakeTelegram(
      async () => {
        throw new Error("unused");
      },
      { id: 123456, username: "sparkbot" },
    );
    api.getChatAdministrators = async () => [];
    expect(await isBotAdministrator(api, -100n)).toBe(false);
  });
});
