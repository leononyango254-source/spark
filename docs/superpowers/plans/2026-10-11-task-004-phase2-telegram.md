# TASK-004 Phase 2 Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PRD §73 Phase 2 — Mini App, Bot, campaign `startapp` parsing, and a live membership verifier — demonstrating Telegram → Backend → verified user.

**Architecture:** `@spark/telegram` grows a fetch-based `TelegramBotClient` (+ typed Bot API responses), a browser-safe `startapp` parse/build module, and membership verifier helpers. A new `apps/bot` long-polls `getUpdates` and answers `/start`, deep-linking into the Mini App. `apps/api` gains `POST /api/campaigns/:publicId/verify` (session-auth, server-derived user, in-memory 5-min cache). The Mini App (`apps/telegram-mini-app`) is a Vite + vanilla TS client.

**Tech Stack:** Fastify 5, node-postgres + Drizzle, Zod 4, Vite 7, `@telegram-apps/sdk`, `@spark/*` workspaces, vitest 3, Testcontainers `postgres:17`. Node >= 22, pnpm 12 (`allowBuilds` already covers `esbuild` for Vite).

---

## Design decisions locked in by the spec

- `startapp` payload: `c_<publicId 16-32>_<referralCode 8>` (≤64 chars); `referralCode` is parsed but **not persisted** until Phase 3.
- Membership cache: in-memory TTL map in the API, default 300s, `?force=1` bypass. `restricted` status passes only when `is_member === true` (PRD §16).
- Bot: long-polling `getUpdates` (no webhook — no public HTTPS requirement in dev).
- **Browser-safety constraint:** `@spark/telegram/campaignLink.ts` must NOT import `@spark/domain` (which imports `node:crypto`) nor `@spark/telegram/initData.ts` (same), or the Vite browser build breaks. campaignLink defines its own tiny regexes identical in shape to `REFERRAL_CODE_PATTERN`/`PUBLIC_ID_PATTERN`. The Mini App re-implements the same parse with `parseStartParam` rather than importing `@spark/telegram`.
- **Confidence note vs spec §6:** `TELEGRAM_WEBAPP_URL`/`TELEGRAM_APP_NAME` are consumed by `apps/bot` (the only process that builds deep links), not `apps/api`. `apps/api` gains only `MEMBERSHIP_CACHE_TTL_MS`.
- `ApiDeps` replaces `telegramBotToken: string | undefined` with `telegram: TelegramBotApi | undefined`; the bot token lives (public-readonly) on `TelegramBotClient.botToken` and is used by the auth route for the initData HMAC.

### File map

- `packages/domain/src/referralCode.ts` (+ test) — `generateReferralCode()`, `REFERRAL_CODE_PATTERN`.
- `packages/telegram/src/botClient.ts` (+ test) — `TelegramBotApi`, `TelegramBotClient`, `TelegramApiError`, `TelegramUpdate`, `InlineKeyboard*`, `ChatMember` import.
- `packages/telegram/src/campaignLink.ts` (+ test) — `parseStartapp`, `buildStartapp`, `buildCampaignDeepLink`.
- `packages/telegram/src/verify.ts` (+ test) — `verifyChannelMembership`, `isBotAdministrator`.
- `packages/db/src/repositories/tasks.ts` — `findMembershipTask`.
- `apps/api/src/cache/membershipCache.ts` (+ test) — `createMembershipCache`.
- `apps/api/src/routes/verify.ts` (+ test) — verify route.
- `apps/api/src/{server,index,env}.ts`, `apps/api/src/routes/auth.ts` — deps rewiring.
- `apps/bot/*` (new app) — `package.json`, `tsconfig.json`, `src/{env,poll,message,index}.ts` (+ poll/message tests).
- `apps/telegram-mini-app/*` — real Vite app + `src/{api,launch,main,env.d}.ts` (+ api/launch tests), `index.html`, `vite.config.ts`, `.env.example`.
- Root: `package.json` scripts `dev:api|dev:bot|dev:mini`; `.env.example` additions; `docs/ARCHITECTURE.md` Telegram note.

---

### Task 1: Referral code generator (`@spark/domain`)

**Files:**
- Create: `packages/domain/src/referralCode.ts`
- Create: `packages/domain/test/referralCode.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/referralCode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateReferralCode, REFERRAL_CODE_PATTERN } from "../src/referralCode";

describe("referralCode", () => {
  it("returns an 8-char URL-safe code", () => {
    const code = generateReferralCode();
    expect(code).toMatch(REFERRAL_CODE_PATTERN);
    expect(code.length).toBe(8);
  });

  it("produces distinct codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 512; i++) seen.add(generateReferralCode());
    expect(seen.size).toBe(512);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @spark/domain test`
Expected: FAIL — `Cannot find module '../src/referralCode'`.

- [ ] **Step 3: Implement the minimal code**

`packages/domain/src/referralCode.ts`:
```ts
import { randomBytes } from "node:crypto";

export const REFERRAL_CODE_PATTERN = /^[0-9a-z]{8}$/;

export function generateReferralCode(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) {
    out += alphabet[byte & 31];
  }
  return out;
}
```

`packages/domain/src/index.ts`:
```ts
export * from "./money";
export * from "./publicId";
export * from "./referralCode";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @spark/domain test`
Expected: PASS (9 tests: 5 money, 2 publicId, 2 referralCode).

- [ ] **Step 5: Commit**

```bash
git add packages/domain && git commit -m "feat(domain): 8-char referral code generator"
```

---

### Task 2: Telegram Bot API client (`@spark/telegram`)

**Files:**
- Create: `packages/telegram/src/botClient.ts`
- Create: `packages/telegram/test/botClient.test.ts`
- Modify: `packages/telegram/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/telegram/test/botClient.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramApiError, TelegramBotClient, type ChatMember } from "../src";

const TOKEN = "123456:TEST_BOT_TOKEN";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TelegramBotClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getChatMember returns the parsed ChatMember", async () => {
    const member: ChatMember = { status: "member" };
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: member }));
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
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: true }));
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    expect(client.botToken).toBe(TOKEN);
    await client.sendMessage(42, "hello", {
      replyMarkup: { inlineKeyboard: [[{ text: "Open", url: "https://t.me/x/y" }]] },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).endsWith("/sendMessage")).toBe(true);
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe("hello");
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe("https://t.me/x/y");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @spark/telegram test`
Expected: FAIL — `Cannot find module '../src'` export `TelegramBotClient`.

- [ ] **Step 3: Implement the minimal code**

`packages/telegram/src/botClient.ts`:
```ts
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
  getMe(): Promise<{ username: string }>;
  getUpdates(opts: { offset: number; timeout: number }): Promise<TelegramUpdate[]>;
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
    const res = await this.#fetch(this.#url(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
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

  async getMe(): Promise<{ username: string }> {
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
}
```

`packages/telegram/src/index.ts`:
```ts
export * from "./botClient";
export * from "./campaignLink";
export * from "./initData";
export * from "./membership";
export * from "./verify";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @spark/telegram test`
Expected: PASS (10 tests; campaignLink + verify modals added in later tasks — set a placeholder there first or run only `test/botClient.test.ts`).

Note: `src/index.ts` references `./campaignLink` and `./verify` before they exist. To keep this task green, create empty placeholder modules now (`campaignLink.ts`: `export {};`, same for `verify.ts`) and fill them in Tasks 3 and 4.

- [ ] **Step 5: Commit**

```bash
git add packages/telegram && git commit -m "feat(telegram): fetch-based Bot API client"
```

---

### Task 3: startapp parse/build + deep-link builder (`@spark/telegram`)

**Files:**
- Modify: `packages/telegram/src/campaignLink.ts` (placeholder created in Task 2)
- Create: `packages/telegram/test/campaignLink.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/telegram/test/campaignLink.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildCampaignDeepLink, buildStartapp, parseStartapp } from "../src";

const PUBLIC = "0123456789abcdef";
const CODE = "abcdefgh";

describe("parseStartapp", () => {
  it("parses a campaign payload with a referral code", () => {
    expect(parseStartapp(`c_${PUBLIC}_${CODE}`)).toEqual({
      kind: "campaign",
      publicId: PUBLIC,
      referralCode: CODE,
    });
  });

  it("parses a campaign payload without a referral code", () => {
    expect(parseStartapp(`c_${PUBLIC}`)).toEqual({ kind: "campaign", publicId: PUBLIC, referralCode: undefined });
  });

  it("rejects garbage, wrong prefix, bad ids, and oversized payloads", () => {
expect(parseStartapp("")).toBeNull();
    expect(parseStartapp("x_123")).toBeNull();
    expect(parseStartapp("c_UPPER")).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_toolong`)).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_${CODE}_extra`)).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_${CODE}${"a".repeat(60)}`)).toBeNull();
});
});

describe("buildStartapp", () => {
  it("round-trips through parseStartapp", () => {
    const built = buildStartapp(PUBLIC, CODE);
    expect(parseStartapp(built)).toEqual({ kind: "campaign", publicId: PUBLIC, referralCode: CODE });
  });

  it("rejects malformed inputs", () => {
    expect(() => buildStartapp("BROKEN")).toThrow(RangeError);
    expect(() => buildStartapp(PUBLIC, "BROKEN_CODE")).toThrow(RangeError);
  });
});

describe("buildCampaignDeepLink", () => {
  it("builds a t.me deep link", () => {
    expect(buildCampaignDeepLink("sparkbot", "app", `c_${PUBLIC}_${CODE}`)).toBe(
      `https://t.me/sparkbot/app?startapp=c_${PUBLIC}_${CODE}`,
    );
  });
});
```

Test coverage note: the oversized case (`payload.length > 64`) returns `null` before regex evaluation — that is the intent of the `length` guard.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @spark/telegram test test/campaignLink.test.ts`
Expected: failure on first assertion (placeholder module exports nothing).

- [ ] **Step 3: Implement the minimal code**

Replace `packages/telegram/src/campaignLink.ts`:
```ts
const PUBLIC_PART = "[0-9a-z]{16,32}";
const CODE_PART = "[0-9a-z]{8}";

export function parseStartapp(payload: string): { kind: "campaign"; publicId: string; referralCode?: string } | null {
  if (payload.length > 64) return null;
  const match = new RegExp(`^c_(${PUBLIC_PART})(?:_(${CODE_PART}))?$`).exec(payload);
  if (!match) return null;
  return { kind: "campaign", publicId: match[1]!, referralCode: match[2] };
}

export function buildStartapp(publicId: string, referralCode?: string): string {
  if (!new RegExp(`^${PUBLIC_PART}$`).test(publicId)) throw new RangeError("invalid publicId");
  if (referralCode !== undefined && !new RegExp(`^${CODE_PART}$`).test(referralCode)) {
    throw new RangeError("invalid referralCode");
  }
  const payload = referralCode === undefined ? `c_${publicId}` : `c_${publicId}_${referralCode}`;
  if (payload.length > 64) throw new RangeError("startapp exceeds 64 chars");
  return payload;
}

export function buildCampaignDeepLink(botUsername: string, appName: string, startapp: string): string {
  return `https://t.me/${botUsername}/${appName}?startapp=${encodeURIComponent(startapp)}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @spark/telegram test`
Expected: PASS — all campaignLink tests.

- [ ] **Step 5: Commit**

```bash
git add packages/telegram && git commit -m "feat(telegram): startapp parse/build + t.me deep links"
```

---

### Task 4: Membership verifier helpers (`@spark/telegram`)

**Files:**
- Modify: `packages/telegram/src/verify.ts` (placeholder created in Task 2)
- Create: `packages/telegram/test/verify.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/telegram/test/verify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  isBotAdministrator,
  TelegramApiError,
  type ChatMember,
  type TelegramBotApi,
  verifyChannelMembership,
} from "../src";

class FakeTelegram implements TelegramBotApi {
  readonly botToken = "123456:TEST";
  constructor(private readonly member: () => Promise<ChatMember>) {}

  getChatMember(): Promise<ChatMember> {
    return this.member();
  }

  getChatAdministrators(): Promise<ChatMember[]> {
    return Promise.resolve([]);
  }

  sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  getMe(): Promise<{ username: string }> {
    return Promise.resolve({ username: "sparkbot" });
  }

  getUpdates(): Promise<never[]> {
    return Promise.resolve([]);
  }
}

describe("verifyChannelMembership", () => {
  it("accepts creator/administrator/member and restricted with is_member", async () => {
    for (const status of ["creator", "administrator", "member"] as const) {
      const api = new FakeTelegram(async () => ({ status }));
      await expect(verifyChannelMembership(api, -100n, 1n)).resolves.toEqual({ ok: true, memberStatus: status });
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
      verifyChannelMembership(new FakeTelegram(async () => Promise.reject(new Error("boom"))), -100n, 1n),
    ).rejects.toThrow("boom");
  });
});

describe("isBotAdministrator", () => {
  it("is true when the bot is creator or administrator", async () => {
    const admins = [
      { status: "administrator" as const },
      { status: "member" as const, is_member: true },
    ];
    const api = new FakeTelegram(async () => {
      throw new Error("unused");
    });
    api.getChatAdministrators = async () => admins;
    expect(await isBotAdministrator(api, -100n)).toBe(true);
    api.getChatAdministrators = async () => [{ status: "member" }];
    expect(await isBotAdministrator(api, -100n)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @spark/telegram test test/verify.test.ts`
Expected: failure (`verifyChannelMembership` undefined).

- [ ] **Step 3: Implement the minimal code**

Replace `packages/telegram/src/verify.ts`:
```ts
import type { TelegramBotApi } from "./botClient";
import { isAcceptedMembership, type ChatMember } from "./membership";
import { TelegramApiError } from "./botClient";

export type MembershipVerification =
  | { ok: true; memberStatus: string }
  | { ok: false; memberStatus: string | null; reason: string };

export async function verifyChannelMembership(
  api: TelegramBotApi,
  chatId: bigint | string,
  telegramUserId: bigint,
): Promise<MembershipVerification> {
  let member: ChatMember;
  try {
    member = await api.getChatMember(chatId, telegramUserId);
  } catch (error) {
    if (error instanceof TelegramApiError) {
      return { ok: false, memberStatus: null, reason: `telegram_${error.code}` };
    }
    throw error;
  }
  if (!isAcceptedMembership(member)) {
    return { ok: false, memberStatus: member.status, reason: "not_member" };
  }
  return { ok: true, memberStatus: member.status };
}

export async function isBotAdministrator(api: TelegramBotApi, chatId: bigint | string): Promise<boolean> {
  const admins = await api.getChatAdministrators(chatId);
  return admins.some((admin) => admin.status === "creator" || admin.status === "administrator");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @spark/telegram test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telegram && git commit -m "feat(telegram): live membership verifier + bot-admin precheck"
```

---

### Task 5: Membership task repository (`@spark/db`)

**Files:**
- Create: `packages/db/src/repositories/tasks.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Implement (pure repository, verified via Task 6 integration tap)**

`packages/db/src/repositories/tasks.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { tasks, type TaskRow } from "../schema";

export async function findMembershipTask(db: Db, campaignId: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.campaignId, campaignId), eq(tasks.type, "TELEGRAM_CHANNEL_MEMBERSHIP")))
    .limit(1);
  return row ?? null;
}
```

`packages/db/src/index.ts` — add the export:
```ts
export * from "./repositories/tasks";
```

- [ ] **Step 2: Typecheck + existing db tests still pass**

Run: `pnpm --filter @spark/db typecheck && pnpm --filter @spark/db test`
Expected: PASS (repository has no direct tests; exercised by API verify integration tests in Task 6).

- [ ] **Step 3: Commit**

```bash
git add packages/db && git commit -m "feat(db): find membership task repository"
```

---

### Task 6: Verify route + membership cache + deps rewiring (`apps/api`)

**Files:**
- Create: `apps/api/src/cache/membershipCache.ts`
- Create: `apps/api/src/cache/membershipCache.test.ts` (pure unit test only)
- Create: `apps/api/src/routes/verify.ts`
- Create: `apps/api/test/verify.test.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/auth.ts`, `apps/api/test/server.test.ts`, `apps/api/test/auth.test.ts`

- [ ] **Step 1: Write the failing cache unit test**

`apps/api/src/cache/membershipCache.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createMembershipCache } from "./membershipCache";

describe("createMembershipCache", () => {
  it("stores entries until ttl passes", () => {
    let now = 1_000;
    const cache = createMembershipCache(300_000, () => now);
    cache.set("k", { verified: true, memberStatus: "member", expiresAt: now + 300_000 });
    expect(cache.get("k")).toMatchObject({ verified: true });
    now += 299_999;
    expect(cache.get("k")).toBeDefined();
    now += 2;
    expect(cache.get("k")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`apps/api/src/cache/membershipCache.ts`:
```ts
export interface MembershipCacheEntry {
  verified: boolean;
  memberStatus: string | null;
  expiresAt: number;
}

export interface MembershipCache {
  ttlMs: number;
  get(key: string): MembershipCacheEntry | undefined;
  set(key: string, entry: MembershipCacheEntry): void;
}

export function createMembershipCache(ttlMs: number, now: () => number = Date.now): MembershipCache {
  const entries = new Map<string, MembershipCacheEntry>();
  return {
    ttlMs,
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry;
    },
    set(key, entry) {
      entries.set(key, entry);
    },
  };
}
```

Run: `pnpm --filter @spark/api test test/cache/membershipCache.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing verify-route integration test**

`apps/api/test/verify.test.ts` (authoritative):
```ts
import { signInitData, TelegramApiError, type ChatMember, type TelegramBotApi } from "@spark/telegram";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startHarness, type Harness } from "../../../packages/db/test/harness";
import { createMembershipCache, type MembershipCache } from "../src/cache/membershipCache";
import { buildServer, type ApiDeps } from "../src/server";

const BOT_TOKEN = "123456:TEST_BOT_TOKEN";
const TELEGRAM_USER_ID = 9001;

function fakeTelegram(getChatMember: () => Promise<ChatMember>, overrides?: Partial<TelegramBotApi>): TelegramBotApi {
  return {
    botToken: BOT_TOKEN,
    getChatMember,
    getChatAdministrators: async () => [],
    sendMessage: async () => {},
    getMe: async () => ({ username: "sparkbot" }),
    getUpdates: async () => [],
    ...overrides,
  };
}

function signInitDataFor(): string {
  const now = Math.floor(Date.now() / 1000);
  return signInitData(
    {
      auth_date: String(now),
      query_id: "AAA",
      user: JSON.stringify({ id: TELEGRAM_USER_ID, first_name: "Alice" }),
    },
    BOT_TOKEN,
  );
}

let h: Harness;
let deps: ApiDeps;
let membershipCache: MembershipCache;
let publicId: string;

beforeAll(async () => {
  h = await startHarness();
  membershipCache = createMembershipCache(300_000);
  deps = {
    db: h.db,
    telegram: fakeTelegram(async () => ({ status: "member" })),
    membershipCache,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
  };

  const { rows } = await h.pool.query<{ id: string }>(
    `INSERT INTO users (telegram_user_id, username) VALUES ($1, 'alice') RETURNING id`,
    [TELEGRAM_USER_ID],
  );
  const userId = rows[0]!.id;
  publicId = `pub${Math.random().toString(36).slice(2, 16)}`;
  const { rows: campRows } = await h.pool.query<{ id: string }>(
    `INSERT INTO campaigns
       (public_id, creator_id, chain_id, reward_micro_usdc, referral_reward_micro_usdc,
        budget_micro_usdc, balance_micro_usdc)
     VALUES ($1, $2, 5042002, 100000, 0, 25000000, 0)
     RETURNING id`,
    [publicId, userId],
  );
  const campaignId = campRows[0]!.id;
  await h.pool.query(
    `INSERT INTO tasks (campaign_id, type, config, reward_micro_usdc)
     VALUES ($1, 'TELEGRAM_CHANNEL_MEMBERSHIP', '{"chat_id": "-1001234"}', 100000)`,
    [campaignId],
  );
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("POST /api/campaigns/:publicId/verify", () => {
  it("returns verified for an accepted membership and caches it", async () => {
    const memberSpy = vi.fn(async () => ({ status: "member" }));
    deps.telegram = fakeTelegram(memberSpy);
    const app = buildServer(deps);
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: signInitDataFor() },
    });
    const token = (auth.json() as { token: string }).token;

    const first = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      verified: true,
      memberStatus: "member",
      campaignId: publicId,
      cached: false,
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.json()).toMatchObject({ verified: true, cached: true });
    expect(memberSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("returns verified:false for a kicked user, bypassing the cache", async () => {
    deps.telegram = fakeTelegram(async () => ({ status: "kicked" }));
    const app = buildServer(deps);
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: signInitDataFor() },
    });
    const token = (auth.json() as { token: string }).token;
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify?force=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      verified: false,
      memberStatus: "kicked",
      campaignId: publicId,
      cached: false,
    });
    await app.close();
  });

  it("maps non-membership Telegram errors to 409", async () => {
    deps.telegram = fakeTelegram(async () => {
      throw new TelegramApiError(400, "chat not found");
    });
    const app = buildServer(deps);
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: signInitDataFor() },
    });
    const token = (auth.json() as { token: string }).token;
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify?force=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "telegram_error", reason: "telegram_400" });
    await app.close();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 404 for an unknown campaign", async () => {
    const app = buildServer(deps);
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: signInitDataFor() },
    });
    const token = (auth.json() as { token: string }).token;
    const res = await app.inject({
      method: "POST",
      url: "/api/campaigns/nope/verify",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 503 when the bot is not configured", async () => {
    const noBot = buildServer({ ...deps, telegram: undefined });
    const res = await noBot.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/verify`,
    });
    expect(res.statusCode).toBe(503);
    await noBot.close();
  });
});
```
Note: the kicked/live-error tests pass `?force=1` so a cached positive from a prior test can't short-circuit them; the TTL/cache-hit path is covered by the first test and the cache unit test.

- [ ] **Step 4: Implement the verify route + cache wiring**

`apps/api/src/routes/verify.ts`:
```ts
import { findCampaignByPublicId, findMembershipTask, type Db } from "@spark/db";
import { type TelegramBotApi, verifyChannelMembership } from "@spark/telegram";
import type { FastifyInstance } from "fastify";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { MembershipCache } from "../cache/membershipCache";

export interface VerifyRouteDeps {
  db: Db;
  telegram: TelegramBotApi | undefined;
  membershipCache: MembershipCache;
}

export function resolveChatId(
  config: Record<string, unknown> | null | undefined,
  targetChatId: bigint | null,
): bigint | string | null {
  const raw = config?.chat_id;
  if (typeof raw === "number") return BigInt(raw);
  if (typeof raw === "string") return raw;
  return targetChatId;
}

export function registerVerifyRoutes(app: FastifyInstance, deps: VerifyRouteDeps): void {
  app.post<{ Params: { publicId: string }; Querystring: { force?: string } }>(
    "/api/campaigns/:publicId/verify",
    async (request, reply) => {
      if (!deps.telegram) return reply.code(503).send({ error: "telegram_not_configured" });

      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });
      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
      if (!campaign) return reply.code(404).send({ error: "not_found" });
      const task = await findMembershipTask(deps.db, campaign.id);
      const chatId = resolveChatId(task?.config, campaign.targetChatId);
      if (chatId === null) return reply.code(422).send({ error: "invalid_task" });

      const force = request.query.force === "1";
      const key = `${campaign.id}:${user.telegramUserId}`;
      if (!force) {
        const cached = deps.membershipCache.get(key);
        if (cached) {
          return reply.send({
            verified: cached.verified,
            memberStatus: cached.memberStatus,
            campaignId: campaign.publicId,
            cached: true,
          });
        }
      }

      const result = await verifyChannelMembership(deps.telegram, chatId, user.telegramUserId);
      if (result.ok) {
        deps.membershipCache.set(key, {
          verified: true,
          memberStatus: result.memberStatus,
          expiresAt: Date.now() + deps.membershipCache.ttlMs,
        });
        return reply.send({
          verified: true,
          memberStatus: result.memberStatus,
          campaignId: campaign.publicId,
          cached: false,
        });
      }
      if (result.reason === "not_member") {
        deps.membershipCache.set(key, {
          verified: false,
          memberStatus: result.memberStatus,
          expiresAt: Date.now() + deps.membershipCache.ttlMs,
        });
        return reply.send({
          verified: false,
          memberStatus: result.memberStatus,
          campaignId: campaign.publicId,
          cached: false,
        });
      }
      return reply.code(409).send({ error: "telegram_error", reason: result.reason });
    },
  );
}
```

`apps/api/src/server.ts`:
```ts
import cookie from "@fastify/cookie";
import type { Db } from "@spark/db";
import type { TelegramBotApi } from "@spark/telegram";
import Fastify, { type FastifyInstance } from "fastify";
import type { MembershipCache } from "./cache/membershipCache";
import { registerAuthRoutes } from "./routes/auth";
import { registerMeRoutes } from "./routes/me";
import { registerVerifyRoutes } from "./routes/verify";

export interface ApiDeps {
  db: Db;
  telegram: TelegramBotApi | undefined;
  membershipCache: MembershipCache;
  sessionTtlSeconds: number;
  nodeEnv: "development" | "test" | "production";
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "spark-api" }));

  app.register(async (instance) => {
    registerAuthRoutes(instance, deps);
    registerMeRoutes(instance, deps);
    registerVerifyRoutes(instance, deps);
  });

  return app;
}
```

- [ ] **Step 5: Rewire auth route + env + index + existing tests**

`apps/api/src/routes/auth.ts` — replace the bot-token check and pass-through:
```ts
export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post("/api/auth/telegram", async (request, reply) => {
    if (!deps.telegram) return reply.code(503).send({ error: "telegram_not_configured" });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const outcome = await authenticateTelegram(deps.db, {
      initData: parsed.data.initData,
      botToken: deps.telegram.botToken,
      sessionTtlSeconds: deps.sessionTtlSeconds,
    });
    if (!outcome.ok) return reply.code(401).send({ error: "unauthorized", reason: outcome.reason });
    // existing setCookie + send unchanged
  });
}
```

`apps/api/src/env.ts` — add DEFAULT/field:
```ts
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  MEMBERSHIP_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
```

`apps/api/src/index.ts`:
```ts
import { TelegramBotClient } from "@spark/telegram";
import { createMembershipCache } from "./cache/membershipCache";
import { buildDb } from "./db";
import { loadEnv } from "./env";
import { buildServer } from "./server";

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the API");
}

const app = buildServer({
  db: buildDb(env.DATABASE_URL),
  telegram: env.TELEGRAM_BOT_TOKEN ? new TelegramBotClient({ botToken: env.TELEGRAM_BOT_TOKEN }) : undefined,
  membershipCache: createMembershipCache(env.MEMBERSHIP_CACHE_TTL_MS),
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  nodeEnv: env.NODE_ENV,
});

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => app.log.info(`spark-api listening on ${address}`))
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
```

`apps/api/test/server.test.ts` — update `testDeps()`:
```ts
import { TelegramBotClient } from "@spark/telegram";
import { createMembershipCache } from "../src/cache/membershipCache";

function testDeps(): Parameters<typeof buildServer>[0] {
  return {
    db: {} as Db,
    telegram: new TelegramBotClient({
      botToken: "123456:TEST",
      fetchImpl: () => Promise.reject(new Error("network must not be used")),
    }),
    membershipCache: createMembershipCache(60_000),
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
  };
}
```

`apps/api/test/auth.test.ts` — update the deps object to the new shape:
```ts
import { TelegramBotClient } from "@spark/telegram";
import { createMembershipCache } from "../src/cache/membershipCache";

deps = {
  db: h.db,
  telegram: new TelegramBotClient({ botToken: BOT_TOKEN }),
  membershipCache: createMembershipCache(60_000),
  sessionTtlSeconds: 3600,
  nodeEnv: "test",
};
```
Keep `BOT_TOKEN` as the initData signing token so the existing auth assertions still hold.

- [ ] **Step 6: Run the api suite + typecheck**

Run: `pnpm --filter @spark/api typecheck && pnpm --filter @spark/api test`
Expected: PASS — 6 existing (server/auth) + 5 verify tests, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages && git commit -m "feat(api): membership verify endpoint with TTL cache"
```

---

### Task 7: Bot daemon (`apps/bot`)

**Files:**
- Create: `apps/bot/package.json`
- Create: `apps/bot/tsconfig.json`
- Create: `apps/bot/src/env.ts`
- Create: `apps/bot/src/poll.ts`
- Create: `apps/bot/src/message.ts`
- Create: `apps/bot/src/index.ts`
- Create: `apps/bot/test/poll.test.ts`
- Create: `apps/bot/test/message.test.ts`

- [ ] **Step 1: Scaffold package + types + poll loop test**

`apps/bot/package.json`:
```json
{
  "name": "@spark/bot",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "node --watch src/index.ts",
    "start": "node src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@spark/telegram": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

`apps/bot/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`apps/bot/test/poll.test.ts` (authoritative):
```ts
import { describe, expect, it } from "vitest";
import { runBot } from "../src/poll";

interface FakeClient {
  me: () => Promise<{ username: string }>;
  updates: (offset: number) => Promise<{ update_id: number; message: { chat: { id: number }; text?: string } }[]>;
}

function makeClient(updates: (offset: number) => number[]): FakeClient {
  return {
    me: async () => ({ username: "sparkbot" }),
    updates: async (offset) =>
      updates(offset).map((update_id) => ({ update_id, message: { chat: { id: 1 }, text: "/start" } })),
  };
}

describe("runBot", () => {
  it("passes increasing offsets and invokes the handler per update", async () => {
    const offsets: number[] = [];
    const handed: number[] = [];
    const ac = new AbortController();
    const client = makeClient((offset) => {
      offsets.push(offset);
      return offset === 0 ? [1, 2] : [];
    });
    const wait = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (offsets.length >= 3) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    const run = runBot({
      client: {
        getMe: client.me,
        getUpdates: (opts) => client.updates(opts.offset),
      },
      handler: async (update) => {
        handed.push(update.update_id);
      },
      timeoutSeconds: 1,
      signal: ac.signal,
    });
    await wait;
    ac.abort();
    await run;
    expect(offsets).toEqual([0, 2, 2]);
    expect(handed).toEqual([1, 2]);
  });
});
```
Expected behavior: first call at offset 0 returns updates [1,2] (handler sees both, next offset 2); subsequent empty polls stay at offset 2; abort exits the loop.

Implement `apps/bot/src/poll.ts`:
```ts
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
    const updates = await opts.client.getUpdates({ offset, timeout });
    for (const update of updates) {
      await opts.handler(update);
      offset = Math.max(offset, update.update_id + 1);
    }
  }
}
```

- [ ] **Step 2: Write the message handler test**

`apps/bot/test/message.test.ts`:
```ts
import { type TelegramBotApi, type TelegramUpdate } from "@spark/telegram";
import { describe, expect, it, vi } from "vitest";
import { handleMessage } from "../src/message";

const BASE = { webappUrl: "https://app.spark.test", appName: "spark", botUsername: "sparkbot" };
const PUBLIC = "0123456789abcdef";

function captured() {
  const sendMessage = vi.fn(async () => {});
  const api = {
    botToken: "123456:TEST",
    sendMessage,
    getChatMember: async () => ({ status: "member" }),
    getChatAdministrators: async () => [],
    getMe: async () => ({ username: "sparkbot" }),
    getUpdates: async () => [],
  } as unknown as TelegramBotApi;
  return { sendMessage, api };
}

function update(text: string | undefined): TelegramUpdate {
  return { update_id: 1, message: { chat: { id: 42 }, text } };
}

describe("handleMessage", () => {
  it("does nothing without /start", async () => {
    const { sendMessage, api } = captured();
    await handleMessage(api, BASE, update("hello"));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends a deep link for /start with a startapp payload", async () => {
    const { sendMessage, api } = captured();
    await handleMessage(api, BASE, update(`/start c_${PUBLIC}_abcdefgh`));
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        replyMarkup: {
          inlineKeyboard: [[{ text: "Open Spark", url: `https://t.me/sparkbot/spark?startapp=c_${PUBLIC}_abcdefgh` }]],
        },
      }),
    );
  });

  it("opens the web app for /start without a payload", async () => {
    const { sendMessage, api } = captured();
    await handleMessage(api, BASE, update("/start"));
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.objectContaining({
        replyMarkup: { inlineKeyboard: [[{ text: "Open Spark", url: "https://app.spark.test" }]] },
      }),
    );
  });
});
```

Implementation `apps/bot/src/message.ts`:
```ts
import { buildCampaignDeepLink, parseStartapp, type TelegramBotApi, type TelegramUpdate } from "@spark/telegram";

export interface MessageEnv {
  webappUrl: string;
  appName: string;
  botUsername: string;
}

export async function handleMessage(api: TelegramBotApi, env: MessageEnv, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const match = /^\/start(?:\s+(.*))?$/.exec(message.text.trim());
  if (!match) return;

  const payload = match[1] ?? undefined;
  const parsed = payload === undefined ? null : parseStartapp(payload);
  const url =
    parsed === null
      ? env.webappUrl
      : buildCampaignDeepLink(env.botUsername, env.appName, payload!);

  await api.sendMessage(message.chat.id, parsed === null ? "Open Spark:" : "Open your campaign:", {
    replyMarkup: { inlineKeyboard: [[{ text: "Open Spark", url }]] },
  });
}
```

- [ ] **Step 3: Wire env + entrypoint**

`apps/bot/src/env.ts`:
```ts
import { z } from "zod";

export const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBAPP_URL: z.string().url(),
  TELEGRAM_APP_NAME: z.string().min(1),
  API_BOT_POLL_TIMEOUT: z.coerce.number().int().min(1).max(50).default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
```

`apps/bot/src/index.ts`:
```ts
import { TelegramBotClient } from "@spark/telegram";
import { loadEnv } from "./env";
import { handleMessage } from "./message";
import { runBot } from "./poll";

async function main(): Promise<void> {
  const env = loadEnv();
  const client = new TelegramBotClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const me = await client.getMe();

  await runBot({
    client,
    handler: (update) =>
      handleMessage(client, {
        webappUrl: env.TELEGRAM_WEBAPP_URL,
        appName: env.TELEGRAM_APP_NAME,
        botUsername: me.username,
      }, update),
    timeoutSeconds: env.API_BOT_POLL_TIMEOUT,
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Run bot tests + typecheck**

Run: `pnpm --filter @spark/bot typecheck && pnpm --filter @spark/bot test`
Expected: PASS (2 poll + 3 message tests).

- [ ] **Step 5: Commit**

```bash
git add apps/bot && git commit -m "feat(bot): long-polling daemon answering /start with deep links"
```

---

### Task 8: Mini App (`apps/telegram-mini-app`)

**Files:**
- Modify: `apps/telegram-mini-app/package.json`
- Create: `apps/telegram-mini-app/tsconfig.json`
- Create: `apps/telegram-mini-app/vite.config.ts`
- Create: `apps/telegram-mini-app/index.html`
- Create: `apps/telegram-mini-app/.env.example`
- Create: `apps/telegram-mini-app/src/env.d.ts`
- Create: `apps/telegram-mini-app/src/api.ts`
- Create: `apps/telegram-mini-app/src/launch.ts`
- Create: `apps/telegram-mini-app/src/main.ts`
- Create: `apps/telegram-mini-app/test/api.test.ts`
- Create: `apps/telegram-mini-app/test/launch.test.ts`

- [ ] **Step 1: Package + build tooling**

`apps/telegram-mini-app/package.json`:
```json
{
  "name": "@spark/telegram-mini-app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@telegram-apps/sdk": "^28.0.0"
  },
  "devDependencies": {
    "vite": "^7.0.0"
  }
}
```

`apps/telegram-mini-app/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"]
  },
  "include": ["src", "test"]
}
```

`apps/telegram-mini-app/vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, host: "0.0.0.0" },
  build: { outDir: "dist" },
});
```

`apps/telegram-mini-app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Spark</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/telegram-mini-app/.env.example`:
```
# API origin the Mini App talks to (dev: http://localhost:3000)
VITE_API_ORIGIN=http://localhost:3000
```

`apps/telegram-mini-app/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Run: `pnpm install` at repo root (adds `vite`, `@telegram-apps/sdk`). If pnpm 12 blocks a build script, add it to `allowBuilds` in `pnpm-workspace.yaml` (esbuild already allowed).

- [ ] **Step 2: Write failing API-client tests**

`apps/telegram-mini-app/test/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticate, buildApiUrl, verify } from "../src/api";

describe("buildApiUrl", () => {
  it("normalizes a trailing slash", () => {
    expect(buildApiUrl("http://localhost:3000/", "/api/me")).toBe("http://localhost:3000/api/me");
  });
});

describe("authenticate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts initData and returns the session", async () => {
    const payload = { token: "abc", expiresAt: "2026-01-01T00:00:00Z", user: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    const got = await authenticate("http://localhost:3000", "init-data");
    expect(got.token).toBe("abc");
  });

  it("throws on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(authenticate("http://localhost:3000", "x")).rejects.toThrow("auth failed: 401");
  });
});

describe("verify", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the campaign verify endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ verified: true, memberStatus: "member" }), { status: 200 })),
    );
    const got = await verify("http://localhost:3000", "tok", "abc123", true);
    expect(got.verified).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `src/api.ts`**

```ts
export function buildApiUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: { id: string; telegramUserId: string; username: string | null };
}

export interface VerifyResponse {
  verified: boolean;
  memberStatus: string | null;
  campaignId: string;
  cached: boolean;
}

export async function authenticate(apiOrigin: string, initData: string): Promise<AuthResponse> {
  const res = await fetch(buildApiUrl(apiOrigin, "/api/auth/telegram"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  return res.json() as Promise<AuthResponse>;
}

export async function verify(
  apiOrigin: string,
  token: string,
  publicId: string,
  force: boolean,
): Promise<VerifyResponse> {
  const query = force ? "?force=1" : "";
  const res = await fetch(
    buildApiUrl(apiOrigin, `/api/campaigns/${encodeURIComponent(publicId)}/verify${query}`),
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);
  return res.json() as Promise<VerifyResponse>;
}
```

- [ ] **Step 4: Write failing launch-param tests + implement `src/launch.ts`**

`apps/telegram-mini-app/test/launch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseStartParam } from "../src/launch";

const PUBLIC = "0123456789abcdef";
const CODE = "abcdefgh";

describe("parseStartParam", () => {
  it("parses campaign payloads with and without a referral code", () => {
    expect(parseStartParam(`c_${PUBLIC}_${CODE}`)).toEqual({ publicId: PUBLIC, referralCode: CODE });
    expect(parseStartParam(`c_${PUBLIC}`)).toEqual({ publicId: PUBLIC, referralCode: undefined });
  });

  it("rejects garbage and oversized payloads", () => {
    expect(parseStartParam("nope")).toBeNull();
    expect(parseStartParam(`c_${PUBLIC}_${CODE}${"a".repeat(60)}`)).toBeNull();
  });
});
```

`apps/telegram-mini-app/src/launch.ts`:
```ts
export function parseStartParam(
  payload: string,
): { publicId: string; referralCode?: string } | null {
  if (payload.length > 64) return null;
  const match = /^c_([0-9a-z]{16,32})(?:_([0-9a-z]{8}))?$/.exec(payload);
  if (!match) return null;
  return { publicId: match[1]!, referralCode: match[2] };
}
```

- [ ] **Step 5: Implement `src/main.ts`**

```ts
import { init, retrieveLaunchParams } from "@telegram-apps/sdk";
import { authenticate, verify } from "./api";
import { parseStartParam } from "./launch";

const app = document.querySelector<HTMLDivElement>("#app");

function render(html: string): void {
  if (!app) return;
  app.innerHTML = html;
}

async function bootstrap(): Promise<void> {
  const launchParams = retrieveLaunchParams();
  const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "";
  const raw = launchParams.initDataRaw ?? "";
  const start = launchParams.startParam ?? null;
  const target = start === null ? null : parseStartParam(start);

  let token: string;
  try {
    const auth = await authenticate(apiOrigin, raw);
    token = auth.token;
  } catch {
    render(`<h1>Spark</h1><p>Auth failed. Open via the Telegram bot.</p>`);
    return;
  }

  if (target === null) {
    render(`<h1>Spark</h1><p>No campaign link found. Ask the bot for one.</p>`);
    return;
  }

  render(`
    <h1>Spark</h1>
    <p>Join the channel, then tap Verify to earn USDC.</p>
    <button id="verify">Verify</button>
    <p id="status"></p>
  `);
  const button = document.querySelector<HTMLButtonElement>("#verify");
  const status = document.querySelector<HTMLParagraphElement>("#status");
  button?.addEventListener("click", async () => {
    if (!status) return;
    status.textContent = "Checking membership…";
    try {
      const res = await verify(apiOrigin, token, target.publicId, true);
      status.textContent = res.verified
        ? `Verified ✓ (${res.memberStatus})`
        : `Not a member yet (${res.memberStatus ?? "unknown"}).`;
    } catch {
      status.textContent = "Verification failed. Try again later.";
    }
  });
}

init({ occurrence: "once", server: false, cloud: false });
void bootstrap();
```

- [ ] **Step 6: Verify mini-app tests + typecheck + build**

Run: `pnpm --filter @spark/telegram-mini-app typecheck && pnpm --filter @spark/telegram-mini-app test && pnpm --filter @spark/telegram-mini-app build`
Expected: PASS — 2 launch + 2 api tests, typecheck clean, `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add apps/telegram-mini-app && git commit -m "feat(mini-app): Vite app with auth, startapp, verify screens"
```

---

### Task 9: Root scripts + `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Scripts**

`package.json` — add to `scripts`:
```json
    "dev:api": "pnpm --filter @spark/api dev",
    "dev:bot": "pnpm --filter @spark/bot dev",
    "dev:mini": "pnpm --filter @spark/telegram-mini-app dev"
```

- [ ] **Step 2: Env docs**

`.env.example` — extend the Telegram block and add a cache var:
```
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBAPP_URL=https://localhost:5173
TELEGRAM_APP_NAME=spark

# Membership verification cache (ms, default 300000)
MEMBERSHIP_CACHE_TTL_MS=300000
```
Keep `TELEGRAM_WEBAPP_URL` (used by `apps/bot`) and note `apps/telegram-mini-app/.env` sets `VITE_API_ORIGIN`.

- [ ] **Step 3: Commit**

```bash
git add package.json .env.example && git commit -m "chore: dev scripts + env docs for bot and mini-app"
```

---

### Task 10: Full verification + docs touch

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: clean (auto-fix with `pnpm exec biome check --write .` if any styling nudges surface; errors only, warnings acceptable).

- [ ] **Step 2: Typecheck + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: all workspaces green — domain (9), arc (3), telegram (previous 7 + new botClient/campaignLink/verify ≈ 21), rewards (5), db (10 + Tasks 4–8 integration parity), worker (2), api (6 + 5 verify), mini-app (4), bot (5).

- [ ] **Step 3: Solidity still green**

Run: `cd contracts && export PATH="$HOME/.foundry/bin:$PATH" && forge test`
Expected: 3/3 pass.

- [ ] **Step 4: Docs**

`docs/ARCHITECTURE.md` — append a Telegram section:
```md
## Telegram (Phase 2)

- `apps/bot` long-polls `getUpdates` and answers `/start`, opening the Mini App (deep links with `startapp=c_<publicId>_<referralCode>`).
- `POST /api/campaigns/:publicId/verify` checks the user's membership in the campaign channel via `getChatMember` (bot must be an admin of the target chat, PRD §15), cached in-memory for `MEMBERSHIP_CACHE_TTL_MS`.
- `apps/telegram-mini-app` is a Vite static client; it posts raw `initData` to `/api/auth/telegram` and never trusts `initDataUnsafe`.
```

- [ ] **Step 5: Commit**

```bash
git add docs && git commit -m "docs(arch): Phase 2 Telegram section"
```

---

## Self-review notes

- **Spec coverage:** startapp parsing (T3, T8), Bot client + verifier + admin precheck (T2, T4), verify endpoint + cache (T5, T6), Mini App (T8), bot daemon (T7), env/wiring (T9), verification (T10). Non-goals untouched.
- **Type consistency:** `TelegramBotApi` is the single interface fakes implement; `MembershipCache` exposes `ttlMs`, `get`, `set`; `verifyChannelMembership` returns `{ok, memberStatus, reason}`; `runBot` uses `Pick<TelegramBotApi, "getMe" | "getUpdates">`.
- **Browser safety:** `campaignLink.ts` and `launch.ts` define local regexes; nothing server-side imports `node:*` transitively into the Mini App bundle.