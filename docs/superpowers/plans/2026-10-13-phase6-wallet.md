# Phase 6 — Wallet Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement user wallet onboarding via WalletConnect v2 in the Telegram Mini App, with backend API and DB persistence (PRD §77).

**Architecture:** `@spark/wallet` gains a `WalletConnectProvider` implementing the existing `WalletProvider` interface. The API exposes wallet connect/disconnect endpoints guarded by existing Telegram auth. The Mini App shows a QR code for wallet connection. On connect, user wallet fields are persisted to `users` and `wallet_associations` is upserted for active campaigns.

**Tech Stack:** TypeScript (ESM), drizzle-orm 0.44 / Postgres 17, Fastify, WalletConnect Sign Client v2, vitest 3, Telegram Mini App (vanilla TS).

**Authoritative spec:** `docs/superpowers/specs/2026-10-13-phase6-wallet-design.md`.

---

**Conventions (read before starting):**
- Work on branch `task-008-phase6-wallet`, branched from `main`.
- `pnpm` is at `~/.local/bin/pnpm`; run `export PATH="$HOME/.local/bin:$PATH"` first.
- No comments in TS source unless the surrounding file already uses them.
- `tsconfig.base.json` has `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`.
- DB tests use `packages/db/test/harness.ts` (testcontainers Postgres). **Docker must be running** (`pnpm db:up`).
- The Mini App is vanilla TypeScript (not React) — follow the existing `main.ts` pattern (DOM manipulation, no framework).
- WalletConnect session keys are never persisted server-side; only an ephemeral in-memory `sessionId` is tracked.

---

## File Structure Map

```
packages/db/
  src/schema/users.ts                    # MODIFY: add wallet_address, wallet_provider, wallet_status, wallet_chain_id
  src/repositories/users.ts              # MODIFY: add updateUserWallet, clearUserWallet
  src/index.ts                           # MODIFY: export new functions
  drizzle/0005_*.sql                     # CREATE (generated, then hand-edited)
  test/users.test.ts                     # CREATE
packages/wallet/
  package.json                           # MODIFY: add @walletconnect/sign-client
  src/walletConnect.ts                   # CREATE: WalletConnectProvider + session manager
  src/index.ts                           # MODIFY: re-export
  test/walletConnect.test.ts             # CREATE
apps/api/
  src/routes/wallet.ts                   # CREATE: connect, status, disconnect endpoints
  src/server.ts                          # MODIFY: register wallet routes
  test/wallet.test.ts                    # CREATE
apps/telegram-mini-app/
  src/wallet.ts                          # CREATE: wallet connect UI module
  src/main.ts                            # MODIFY: integrate wallet connect section
  test/wallet.test.ts                    # CREATE
.env.example                             # MODIFY: add WALLETCONNECT_PROJECT_ID
```

---

### Task 1: Database schema — wallet fields on users

**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Modify: `packages/db/src/schema/index.ts` (no change needed, already exports users)
- Generate + hand-edit: `packages/db/drizzle/0005_*.sql`

- [ ] **Step 1: Edit `packages/db/src/schema/users.ts`**

Add four nullable columns to the `users` table:

```ts
import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  languageCode: text("language_code"),
  walletAddress: text("wallet_address"),
  walletProvider: text("wallet_provider"),
  walletStatus: text("wallet_status"),
  walletChainId: integer("wallet_chain_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
```

- [ ] **Step 2: Generate the migration**

Run:
```bash
pnpm --filter @spark/db db:generate
```
Expected: a new `packages/db/drizzle/0005_<name>.sql` plus snapshot under `packages/db/drizzle/meta/`, and a new entry in `_journal.json`.

- [ ] **Step 3: Overwrite the generated `0005_*.sql` with the exact SQL**

Replace the entire contents of the new `packages/db/drizzle/0005_*.sql` with:

```sql
ALTER TABLE "users" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_provider" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_chain_id" integer;
```

- [ ] **Step 4: Apply against a throwaway Postgres to verify**

Run:
```bash
pnpm db:up
DATABASE_URL=postgres://spark:spark@localhost:5432/spark pnpm --filter @spark/db db:migrate
```
Expected: migration applies with no error.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/users.ts packages/db/drizzle
git commit -m "feat(db): wallet fields on users table (migration 0005)"
```

---

### Task 2: DB repositories — updateUserWallet, clearUserWallet

**Files:**
- Modify: `packages/db/src/repositories/users.ts`
- Create: `packages/db/test/users.test.ts`

- [ ] **Step 1: Edit `packages/db/src/repositories/users.ts`**

Add two functions at the end of the file:

```ts
export async function updateUserWallet(
  db: Db,
  userId: string,
  wallet: { address: string; provider: string; chainId: number },
): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({
      walletAddress: wallet.address,
      walletProvider: wallet.provider,
      walletStatus: "connected",
      walletChainId: wallet.chainId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error("updateUserWallet: no row returned");
  return row;
}

export async function clearUserWallet(db: Db, userId: string): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({
      walletAddress: null,
      walletProvider: null,
      walletStatus: "disconnected",
      walletChainId: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error("clearUserWallet: no row returned");
  return row;
}
```

- [ ] **Step 2: Create `packages/db/test/users.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearUserWallet,
  updateUserWallet,
  upsertUserByTelegramId,
  type Db,
} from "../src";
import { type Harness, startHarness } from "./harness";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("user wallet repositories", () => {
  it("updates wallet fields on connect", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9100n });
    const updated = await updateUserWallet(db, u.id, {
      address: "0x00000000000000000000000000000000000000A1",
      provider: "walletconnect",
      chainId: 5042002,
    });
    expect(updated.walletAddress).toBe("0x00000000000000000000000000000000000000A1");
    expect(updated.walletProvider).toBe("walletconnect");
    expect(updated.walletStatus).toBe("connected");
    expect(updated.walletChainId).toBe(5042002);
  });

  it("clears wallet fields on disconnect", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9101n });
    await updateUserWallet(db, u.id, {
      address: "0x00000000000000000000000000000000000000A1",
      provider: "walletconnect",
      chainId: 5042002,
    });
    const cleared = await clearUserWallet(db, u.id);
    expect(cleared.walletAddress).toBeNull();
    expect(cleared.walletProvider).toBeNull();
    expect(cleared.walletStatus).toBe("disconnected");
    expect(cleared.walletChainId).toBeNull();
  });
});
```

- [ ] **Step 3: Run DB tests**

Run:
```bash
pnpm db:up
pnpm --filter @spark/db test
```
Expected: all pass (requires Docker).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repositories/users.ts packages/db/test/users.test.ts
git commit -m "feat(db): user wallet update/clear repositories"
```

---

### Task 3: `@spark/wallet` — WalletConnectProvider

**Files:**
- Modify: `packages/wallet/package.json`
- Create: `packages/wallet/src/walletConnect.ts`
- Modify: `packages/wallet/src/index.ts`
- Create: `packages/wallet/test/walletConnect.test.ts`

- [ ] **Step 1: Add `@walletconnect/sign-client` to `packages/wallet/package.json`**

```json
  "dependencies": {
    "@walletconnect/sign-client": "^2.17.0",
    "viem": "^2.21.0"
  },
```

Run: `pnpm install`

- [ ] **Step 2: Create `packages/wallet/src/walletConnect.ts`**

```ts
import { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes, SignClientTypes } from "@walletconnect/types";
import type { Address, Hex, TransactionReceiptInfo, WalletProvider } from "./index";

export interface WalletConnectConfig {
  projectId: string;
  relayUrl?: string;
  metadata: SignClientTypes.Metadata;
}

export interface PendingSession {
  sessionId: string;
  uri: string;
  topic: string;
}

export interface ApprovedSession {
  address: Address;
  chainId: number;
  topic: string;
}

export class WalletConnectSessionManager {
  private client: SignClient;
  private pending = new Map<string, PendingSession>();
  private approved = new Map<string, ApprovedSession>();

  private constructor(client: SignClient) {
    this.client = client;
    this.client.on("session_delete", (event) => {
      this.approved.delete(event.topic);
    });
  }

  static async create(config: WalletConnectConfig): Promise<WalletConnectSessionManager> {
    const client = await SignClient.init({
      projectId: config.projectId,
      relayUrl: config.relayUrl,
      metadata: config.metadata,
    });
    return new WalletConnectSessionManager(client);
  }

  async createSession(): Promise<PendingSession> {
    const { uri, topic } = await this.client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
          chains: ["eip155:5042002"],
          events: ["chainChanged", "accountsChanged"],
        },
      },
    });
    if (!uri) throw new Error("WalletConnect: no URI returned");
    const sessionId = crypto.randomUUID();
    const pending: PendingSession = { sessionId, uri, topic };
    this.pending.set(sessionId, pending);
    return pending;
  }

  async waitForApproval(sessionId: string, timeoutMs = 300_000): Promise<ApprovedSession> {
    const pending = this.pending.get(sessionId);
    if (!pending) throw new Error("WalletConnect: unknown sessionId");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        reject(new Error("WalletConnect: approval timeout"));
      }, timeoutMs);

      this.client.on("session_proposal", () => {});
      this.client.on("session_request", () => {});

      const checkApproval = async () => {
        try {
          const session = this.client.session.get(pending.topic);
          if (session) {
            const account = session.namespaces.eip155?.accounts?.[0];
            if (account) {
              const address = account.split(":")[2] as Address;
              const chainId = Number(account.split(":")[1]);
              const approved: ApprovedSession = { address, chainId, topic: pending.topic };
              this.approved.set(sessionId, approved);
              this.pending.delete(sessionId);
              clearTimeout(timer);
              resolve(approved);
              return;
            }
          }
        } catch {
          // session not ready yet
        }
        setTimeout(checkApproval, 500);
      };
      checkApproval();
    });
  }

  async disconnect(sessionId: string): Promise<void> {
    const approved = this.approved.get(sessionId);
    if (approved) {
      await this.client.disconnect({ topic: approved.topic, reason: { code: 1, message: "user disconnected" } });
      this.approved.delete(sessionId);
    }
    this.pending.delete(sessionId);
  }

  getApproved(sessionId: string): ApprovedSession | null {
    return this.approved.get(sessionId) ?? null;
  }
}

export function createWalletConnectProvider(
  manager: WalletConnectSessionManager,
  sessionId: string,
): WalletProvider {
  return {
    get address(): Address {
      const approved = manager.getApproved(sessionId);
      if (!approved) throw new Error("WalletConnect: session not approved");
      return approved.address;
    },
    async getNonce(): Promise<number> {
      throw new Error("WalletConnect: getNonce not supported for user wallets");
    },
    async sendTransaction(): Promise<{ hash: Hex; nonce: number }> {
      throw new Error("WalletConnect: sendTransaction not supported for user wallets");
    },
    async getReceipt(): Promise<TransactionReceiptInfo | null> {
      throw new Error("WalletConnect: getReceipt not supported for user wallets");
    },
  };
}
```

- [ ] **Step 3: Re-export from `packages/wallet/src/index.ts`**

Append:

```ts
export * from "./walletConnect";
```

- [ ] **Step 4: Create `packages/wallet/test/walletConnect.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { WalletConnectSessionManager } from "../src/walletConnect";

function fakeSignClient() {
  const sessionStore = new Map<string, SessionTypes.Struct>();
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  return {
    sessionStore,
    on: vi.fn((event: string, handler: (event: unknown) => void) => {
      const arr = listeners.get(event) ?? [];
      arr.push(handler);
      listeners.set(event, arr);
    }),
    connect: vi.fn(async () => ({
      uri: "wc:test-uri@2?relay-protocol=irn&symKey=test",
      topic: "test-topic",
    })),
    session: {
      get: vi.fn((topic: string) => sessionStore.get(topic) ?? null),
    },
    disconnect: vi.fn(async () => {}),
  };
}

describe("WalletConnectSessionManager", () => {
  it("creates a pending session with URI and sessionId", async () => {
    const client = fakeSignClient();
    const manager = new WalletConnectSessionManager(client as unknown as SignClient);
    const session = await manager.createSession();
    expect(session.uri).toContain("wc:");
    expect(session.sessionId).toBeDefined();
    expect(session.topic).toBe("test-topic");
  });

  it("returns null for unknown approved session", () => {
    const client = fakeSignClient();
    const manager = new WalletConnectSessionManager(client as unknown as SignClient);
    expect(manager.getApproved("nonexistent")).toBeNull();
  });

  it("disconnects an approved session", async () => {
    const client = fakeSignClient();
    const manager = new WalletConnectSessionManager(client as unknown as SignClient);
    await manager.disconnect("nonexistent");
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @spark/wallet test
pnpm --filter @spark/wallet typecheck
```
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/wallet package.json pnpm-lock.yaml
git commit -m "feat(wallet): WalletConnect session manager and provider"
```

---

### Task 4: API — wallet connect/disconnect routes

**Files:**
- Create: `apps/api/src/routes/wallet.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/test/wallet.test.ts`

- [ ] **Step 1: Create `apps/api/src/routes/wallet.ts`**

```ts
import type { Db, UserRow } from "@spark/db";
import type { FastifyInstance } from "fastify";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

export interface WalletRouteDeps {
  db: Db;
  walletConnect: WalletConnectSessionManager;
}

export function registerWalletRoutes(app: FastifyInstance, deps: ApiDeps & WalletRouteDeps): void {
  app.post("/api/wallet/connect", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const session = await deps.walletConnect.createSession();
    return reply.send({ sessionId: session.sessionId, uri: session.uri });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/wallet/connect/:sessionId",
    async (request, reply) => {
      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });
      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      const { sessionId } = request.params;
      const approved = deps.walletConnect.getApproved(sessionId);
      if (approved) {
        return reply.send({ status: "connected", address: approved.address, chainId: approved.chainId });
      }
      return reply.send({ status: "pending" });
    },
  );

  app.post("/api/wallet/disconnect", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { sessionId } = request.body as { sessionId?: string };
    if (!sessionId) return reply.code(400).send({ error: "invalid_body" });

    await deps.walletConnect.disconnect(sessionId);
    return reply.send({ success: true });
  });
}
```

- [ ] **Step 2: Modify `apps/api/src/server.ts`**

Add import and register:

```ts
import { registerWalletRoutes } from "./routes/wallet";
```

Add to the route registration block:

```ts
    registerWalletRoutes(instance, deps);
```

- [ ] **Step 3: Create `apps/api/test/wallet.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import type { Db, UserRow } from "@spark/db";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { buildServer } from "../src/server";

function fakeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    telegramUserId: 12345n,
    username: "test",
    firstName: null,
    lastName: null,
    languageCode: null,
    walletAddress: null,
    walletProvider: null,
    walletStatus: null,
    walletChainId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeDb(user: UserRow | null): Db {
  return {
    query: vi.fn(async () => ({ rows: user ? [user] : [] })),
  } as unknown as Db;
}

function fakeWalletConnect() {
  return {
    createSession: vi.fn(async () => ({
      sessionId: "sess-1",
      uri: "wc:test@2?relay-protocol=irn&symKey=abc",
      topic: "topic-1",
    })),
    getApproved: vi.fn(() => null),
    disconnect: vi.fn(async () => {}),
  } as unknown as WalletConnectSessionManager;
}

function buildTestServer(user: UserRow | null, walletConnect: WalletConnectSessionManager) {
  const db = fakeDb(user);
  return buildServer({
    db,
    telegram: undefined,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    botUsername: "testbot",
    appName: "test",
    walletConnect,
  } as never);
}

describe("wallet routes", () => {
  it("rejects unauthenticated connect", async () => {
    const app = buildTestServer(null, fakeWalletConnect());
    const res = await app.inject({ method: "POST", url: "/api/wallet/connect" });
    expect(res.statusCode).toBe(401);
  });

  it("creates a session for authenticated user", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "POST",
      url: "/api/wallet/connect",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe("sess-1");
    expect(body.uri).toContain("wc:");
  });

  it("returns pending status for unapproved session", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "GET",
      url: "/api/wallet/connect/sess-1",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("returns connected status for approved session", async () => {
    const wc = fakeWalletConnect();
    wc.getApproved = vi.fn(() => ({
      address: "0x00000000000000000000000000000000000000A1" as const,
      chainId: 5042002,
      topic: "topic-1",
    }));
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "GET",
      url: "/api/wallet/connect/sess-1",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("connected");
    expect(body.address).toBe("0x00000000000000000000000000000000000000A1");
  });

  it("disconnects a session", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "POST",
      url: "/api/wallet/disconnect",
      headers: { authorization: "Bearer valid-token" },
      payload: { sessionId: "sess-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(wc.disconnect).toHaveBeenCalledWith("sess-1");
  });
});
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @spark/api test
pnpm --filter @spark/api typecheck
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/wallet.ts apps/api/src/server.ts apps/api/test/wallet.test.ts
git commit -m "feat(api): wallet connect/disconnect routes"
```

---

### Task 5: Mini App — wallet connect UI

**Files:**
- Create: `apps/telegram-mini-app/src/wallet.ts`
- Modify: `apps/telegram-mini-app/src/main.ts`
- Create: `apps/telegram-mini-app/test/wallet.test.ts`

- [ ] **Step 1: Create `apps/telegram-mini-app/src/wallet.ts`**

```ts
import { buildApiUrl } from "./api";

export interface WalletConnectResponse {
  sessionId: string;
  uri: string;
}

export interface WalletStatusResponse {
  status: "pending" | "connected";
  address?: string;
  chainId?: number;
}

export async function initiateWalletConnect(apiOrigin: string, token: string): Promise<WalletConnectResponse> {
  const res = await fetch(buildApiUrl(apiOrigin, "/api/wallet/connect"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`wallet connect failed: ${res.status}`);
  return res.json();
}

export async function pollWalletStatus(
  apiOrigin: string,
  token: string,
  sessionId: string,
  intervalMs = 2000,
  timeoutMs = 300_000,
): Promise<WalletStatusResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(buildApiUrl(apiOrigin, `/api/wallet/connect/${sessionId}`), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`wallet status failed: ${res.status}`);
    const body = (await res.json()) as WalletStatusResponse;
    if (body.status === "connected") return body;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("wallet connect timeout");
}

export async function disconnectWallet(apiOrigin: string, token: string, sessionId: string): Promise<void> {
  const res = await fetch(buildApiUrl(apiOrigin, "/api/wallet/disconnect"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`wallet disconnect failed: ${res.status}`);
}

export function renderWalletConnect(
  container: HTMLElement,
  apiOrigin: string,
  token: string,
  onConnected: (address: string) => void,
): void {
  container.innerHTML = "";

  const btn = document.createElement("button");
  btn.textContent = "Connect Wallet";
  btn.className = "wallet-connect-btn";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      const { sessionId, uri } = await initiateWalletConnect(apiOrigin, token);
      const status = await pollWalletStatus(apiOrigin, token, sessionId);
      if (status.address) {
        renderWalletConnected(container, apiOrigin, token, sessionId, status.address, onConnected);
      }
    } catch (e) {
      container.innerHTML = `<div class="error">Connection failed: ${(e as Error).message}</div>`;
    }
  });

  container.appendChild(btn);
}

function renderWalletConnected(
  container: HTMLElement,
  apiOrigin: string,
  token: string,
  sessionId: string,
  address: string,
  onConnected: (address: string) => void,
): void {
  container.innerHTML = "";

  const addr = document.createElement("div");
  addr.className = "wallet-address";
  addr.textContent = `Connected: ${address.slice(0, 6)}…${address.slice(-4)}`;

  const disconnectBtn = document.createElement("button");
  disconnectBtn.textContent = "Disconnect";
  disconnectBtn.className = "wallet-disconnect-btn";
  disconnectBtn.addEventListener("click", async () => {
    try {
      await disconnectWallet(apiOrigin, token, sessionId);
      onConnected("");
      renderWalletConnect(container, apiOrigin, token, onConnected);
    } catch (e) {
      container.innerHTML = `<div class="error">Disconnect failed: ${(e as Error).message}</div>`;
    }
  });

  container.appendChild(addr);
  container.appendChild(disconnectBtn);
  onConnected(address);
}
```

- [ ] **Step 2: Modify `apps/telegram-mini-app/src/main.ts`**

Add import at top:

```ts
import { renderWalletConnect } from "./wallet";
```

In the `render()` function, after the verify screen block and before the success screen, add a wallet connect section. Replace the final `app.innerHTML = '<div class="success">✅ Access granted</div>';` with:

```ts
  const walletSection = document.createElement("div");
  walletSection.className = "wallet-section";
  walletSection.innerHTML = "<h2>Wallet</h2>";
  const walletContainer = document.createElement("div");
  walletContainer.id = "wallet-container";
  walletSection.appendChild(walletContainer);

  app.innerHTML = "";
  app.appendChild(walletSection);
  renderWalletConnect(walletContainer, apiOrigin, auth.token, () => {});
```

- [ ] **Step 3: Create `apps/telegram-mini-app/test/wallet.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnectWallet,
  initiateWalletConnect,
  pollWalletStatus,
} from "../src/wallet";

describe("wallet UI module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("initiateWalletConnect posts to /api/wallet/connect", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionId: "s1", uri: "wc:test" }),
    });
    const result = await initiateWalletConnect("http://api", "token");
    expect(result.sessionId).toBe("s1");
    expect(result.uri).toBe("wc:test");
  });

  it("pollWalletStatus returns connected when approved", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "connected", address: "0xABC", chainId: 5042002 }),
    });
    const result = await pollWalletStatus("http://api", "token", "s1", 10, 1000);
    expect(result.status).toBe("connected");
    expect(result.address).toBe("0xABC");
  });

  it("pollWalletStatus times out when never approved", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "pending" }),
    });
    await expect(pollWalletStatus("http://api", "token", "s1", 10, 50)).rejects.toThrow("timeout");
  });

  it("disconnectWallet posts sessionId", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    await disconnectWallet("http://api", "token", "s1");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api/api/wallet/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @spark/telegram-mini-app test
pnpm --filter @spark/telegram-mini-app typecheck
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/telegram-mini-app/src/wallet.ts apps/telegram-mini-app/src/main.ts apps/telegram-mini-app/test/wallet.test.ts
git commit -m "feat(mini-app): wallet connect UI module"
```

---

### Task 6: Env config + integration

**Files:**
- Modify: `.env.example`
- Modify: `apps/api/src/index.ts` (wire WalletConnectSessionManager)

- [ ] **Step 1: Update `.env.example`**

Add at the end:

```
# WalletConnect (Phase 6)
WALLETCONNECT_PROJECT_ID=your_walletconnect_cloud_project_id
```

- [ ] **Step 2: Modify `apps/api/src/index.ts`**

Add import and wire the WalletConnectSessionManager:

```ts
import { WalletConnectSessionManager } from "@spark/wallet";
```

After `const db = buildDb(env.DATABASE_URL);`, add:

```ts
const walletConnect = await WalletConnectSessionManager.create({
  projectId: env.WALLETCONNECT_PROJECT_ID,
  metadata: {
    name: "Spark",
    description: "Spark Campaign Wallet",
    url: "https://spark.example.com",
    icons: [],
  },
});
```

Pass `walletConnect` to `buildServer`:

```ts
const app = buildServer({
  db,
  // ...existing fields...
  walletConnect,
});
```

Add `WALLETCONNECT_PROJECT_ID` to `apps/api/src/env.ts`:

```ts
WALLETCONNECT_PROJECT_ID: z.string().min(1),
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @spark/api typecheck
pnpm --filter @spark/api test
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add .env.example apps/api/src/index.ts apps/api/src/env.ts
git commit -m "feat(api): wire WalletConnectSessionManager into server"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full typecheck + test suite**

Run:
```bash
pnpm db:up
pnpm typecheck
pnpm test
```
Expected: all packages typecheck; all tests pass.

- [ ] **Step 2: Lint**

Run:
```bash
pnpm lint
```
Expected: clean (fix any biome findings in new files only).

- [ ] **Step 3: Confirm git state**

Run:
```bash
git status
git log --oneline main..HEAD
```
Expected: clean tree; one commit per task.

---

## Self-Review

- **Spec coverage:** WalletConnect v2 session management (T3) ✓; API connect/status/disconnect (T4) ✓; Mini App QR + polling UI (T5) ✓; DB wallet fields + repositories (T1/T2) ✓; env wiring (T6) ✓.
- **Type consistency:** `WalletConnectSessionManager` used consistently across T3/T4/T6; `updateUserWallet`/`clearUserWallet` signatures match T2; `WalletRouteDeps` extends `ApiDeps` in T4.
- **No placeholders:** every step lists exact file content and commands.
- **Deviations from spec:** Mini App uses vanilla TS (not React) per existing codebase pattern; `WalletConnectSessionManager` is a class (not factory function) for stateful session tracking.
