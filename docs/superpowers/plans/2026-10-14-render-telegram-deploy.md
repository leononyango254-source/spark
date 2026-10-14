# Render + Neon Telegram Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Spark Telegram Mini App + Fastify API + bot + Postgres to a single free Render web service backed by Neon, with the bot running as a Telegram webhook.

**Architecture:** One Render Web Service serves the Vite-built Mini App (static), the existing `/api/*` Fastify routes, and `POST /api/telegram/webhook`. Postgres is Neon (pooled URL for the app, direct URL for migrations). API and bot are bundled to single JS files with esbuild and run with `node` (no `tsx`).

**Tech Stack:** Node 22, pnpm 12 workspaces, Fastify 5, `@fastify/static`, esbuild, Vitest, Drizzle Kit, Neon Postgres, Render Blueprint (`render.yaml`).

---

## File Structure

**Created**
- `esbuild.config.mjs` — bundles `apps/api` and `apps/bot` to `dist/index.js`.
- `scripts/start-api.sh` — runs migrations (direct URL) then starts the bundled API.
- `scripts/telegram-setup.mjs` — idempotent `setWebhook` + `setChatMenuButton`.
- `apps/api/src/routes/telegram.ts` — `POST /api/telegram/webhook`.
- `apps/api/test/telegramWebhook.test.ts` — webhook secret + dispatch tests.
- `apps/api/test/static.test.ts` — Mini App static serving + SPA fallback tests.
- `render.yaml` — Render Blueprint.
- `.env.prod.example` — documented env shape (placeholders only).
- `.node-version` — pin Node 22.
- `docs/deploy-render.md` — runbook.

**Modified**
- `packages/telegram/src/botClient.ts` — webhook + menu-button methods; sanitized errors.
- `packages/telegram/test/botClient.test.ts` — tests for new methods.
- `apps/bot/package.json` — expose `./message` subpath export.
- `apps/api/src/env.ts` — add `TELEGRAM_WEBAPP_URL`, `TELEGRAM_WEBHOOK_SECRET`, `WEB_DIST_DIR`.
- `apps/api/src/server.ts` — static serving, SPA fallback, webhook route wiring.
- `apps/api/src/index.ts` — pass webhook config + `webDistDir`.
- `apps/api/package.json` — add `@fastify/static`.
- `apps/telegram-mini-app/src/main.ts` — relative API origin.
- `apps/telegram-mini-app/src/env.d.ts` — `VITE_API_ORIGIN?: string`.
- `apps/telegram-mini-app/test/api.test.ts` — relative-origin test.
- `package.json` — `build` scripts + `esbuild` devDep.
- `.gitignore` — allow `.env.prod.example`.

---

## Task 1: Reconcile workspace, commit, and create the GitHub remote

**Files:**
- Modify: `pnpm-lock.yaml` (regenerate), commit existing Phase 6–8 tree.

- [ ] **Step 1: Reconcile the lockfile and link dependencies**

Run:
```bash
cd /Users/leonokwatch/Spark
pnpm install --no-frozen-lockfile
```
Expected: completes; `apps/api/node_modules/viem` now exists.

- [ ] **Step 2: Confirm the full workspace still validates**

Run:
```bash
pnpm -r --if-present run typecheck && pnpm -r --if-present run test
```
Expected: all typechecks pass; tests pass (the `phase7-e2e` case may skip).

- [ ] **Step 3: Set git identity (repo currently has none)**

Run:
```bash
git config user.name "leononyango254-source"
git config user.email "leononyango254-source@users.noreply.github.com"
```

- [ ] **Step 4: Commit the Phase 6–8 working tree**

Run:
```bash
git add -A
git commit -m "feat(phase8): wallet onboarding, settlement demo, lint polish"
```
Expected: one commit; `git status --short` is clean.

- [ ] **Step 5: Create the GitHub repo and push**

Run:
```bash
gh repo create spark --private --source=. --remote=origin --push
git push -u origin main
git push -u origin task-008-phase6-wallet
```
Expected: repo created under `leononyango254-source`; both branches pushed. Record the repo URL.

- [ ] **Step 6: Merge the feature branch into main (deploy source)**

Run:
```bash
git checkout main
git merge --no-ff task-008-phase6-wallet -m "merge: phase 6-8 (wallet, settlement demo, polish)"
git push origin main
```
Expected: `main` contains all work; Render will build from `main`.

---

## Task 2: Telegram client — webhook + menu button methods

**Files:**
- Modify: `packages/telegram/src/botClient.ts`
- Test: `packages/telegram/test/botClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/telegram/test/botClient.test.ts` (inside the existing `describe`):
```ts
  it("setWebhook posts the url and secret token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true, result: true }));
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    await client.setWebhook({ url: "https://x.test/api/telegram/webhook", secretToken: "s3cr3t" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).endsWith("/setWebhook")).toBe(true);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      url: "https://x.test/api/telegram/webhook",
      secret_token: "s3cr3t",
    });
  });

  it("setChatMenuButton points at the Mini App", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true, result: true }));
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    await client.setChatMenuButton({ webAppUrl: "https://x.test" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).endsWith("/setChatMenuButton")).toBe(true);
    const body = JSON.parse(String(init?.body));
    expect(body.menu_button.type).toBe("web_app");
    expect(body.menu_button.web_app.url).toBe("https://x.test");
  });

  it("does not leak the token in network errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error(`request to https://api.telegram.org/bot${TOKEN}/getMe failed`);
    });
    const client = new TelegramBotClient({ botToken: TOKEN, fetchImpl: fetchMock });
    await expect(client.getMe()).rejects.not.toThrow(TOKEN);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @spark/telegram test`
Expected: FAIL — `setWebhook` / `setChatMenuButton` are not functions.

- [ ] **Step 3: Implement the methods**

In `packages/telegram/src/botClient.ts`, add to the `TelegramBotApi` interface (after `getUpdates`):
```ts
  setWebhook(opts: { url: string; secretToken: string }): Promise<void>;
  deleteWebhook(): Promise<void>;
  setChatMenuButton(opts: { webAppUrl: string; text?: string }): Promise<void>;
```

Wrap `#call` so errors never include the token-bearing URL. Replace the existing `#call` body's fetch call with a try/catch:
```ts
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
```

Add the three methods at the end of the class:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @spark/telegram test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telegram/src/botClient.ts packages/telegram/test/botClient.test.ts
git commit -m "feat(telegram): webhook + menu button client methods; sanitize errors"
```

---

## Task 2b: Expose the bot message handler for API reuse

**Files:**
- Modify: `apps/bot/package.json`.

- [ ] **Step 1: Add the subpath export**

In `apps/bot/package.json`, replace the `exports` block:
```json
  "exports": {
    ".": "./src/index.ts",
    "./message": "./src/message.ts"
  },
```

- [ ] **Step 2: Verify nothing breaks**

Run: `pnpm --filter @spark/bot test`
Expected: PASS (`message.test.ts` unaffected).

- [ ] **Step 3: Commit**

```bash
git add apps/bot/package.json
git commit -m "chore(bot): expose ./message subpath for API webhook"
```

---

## Task 3: API env additions

**Files:**
- Modify: `apps/api/src/env.ts`
- Test: `apps/api/test/server.test.ts`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/server.test.ts`, inside the `describe("api", ...)` block after the existing env test, add:
```ts
  it("parses telegram + web dist env", () => {
    const env = loadEnv({
      TELEGRAM_WEBAPP_URL: "https://x.test",
      TELEGRAM_WEBHOOK_SECRET: "s3cr3t",
      WEB_DIST_DIR: "apps/telegram-mini-app/dist",
    } as NodeJS.ProcessEnv);
    expect(env.TELEGRAM_WEBAPP_URL).toBe("https://x.test");
    expect(env.TELEGRAM_WEBHOOK_SECRET).toBe("s3cr3t");
    expect(env.WEB_DIST_DIR).toBe("apps/telegram-mini-app/dist");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spark/api test -- server.test.ts`
Expected: FAIL — values are `undefined`.

- [ ] **Step 3: Add the schema keys**

In `apps/api/src/env.ts`, add to `envSchema` (before the closing `});`):
```ts
  TELEGRAM_WEBAPP_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spark/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env.ts apps/api/test/server.test.ts
git commit -m "feat(api): add telegram webhook + web dist env vars"
```

---

## Task 4: Telegram webhook route

**Files:**
- Create: `apps/api/src/routes/telegram.ts`
- Create: `apps/api/test/telegramWebhook.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/telegramWebhook.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { TelegramBotApi } from "@spark/telegram";
import { buildServer } from "../src/server";

function fakeTelegram() {
  const sendMessage = vi.fn(async () => {});
  const api = {
    botToken: "token",
    sendMessage,
  } as unknown as TelegramBotApi;
  return { api, sendMessage };
}

function buildTestServer(telegram: TelegramBotApi | undefined, webhook?: { secret: string; webappUrl: string }) {
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
    const res = await app.inject({ method: "POST", url: "/api/telegram/webhook", payload: UPDATE });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spark/api test`
Expected: FAIL — `/api/telegram/webhook` returns 404.

- [ ] **Step 3: Create the route**

Create `apps/api/src/routes/telegram.ts`:
```ts
import type { TelegramUpdate } from "@spark/telegram";
import { handleMessage, type MessageEnv } from "@spark/bot/message";
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
      // never fail webhook delivery on handler errors; Telegram would retry
    }
    return reply.code(200).send({ ok: true });
  });
}
```

- [ ] **Step 4: Wire it into the server**

In `apps/api/src/server.ts`:
Add to the type imports near the other route imports:
```ts
import { registerTelegramWebhookRoutes } from "./routes/telegram";
```
Add to `ApiDeps` (after `settlement?`):
```ts
  telegramWebhook?: { secret: string; webappUrl: string };
```
Inside the `app.register(async (instance) => { ... })` block, add:
```ts
    registerTelegramWebhookRoutes(instance, deps);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @spark/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/telegram.ts apps/api/src/server.ts apps/api/test/telegramWebhook.test.ts
git commit -m "feat(api): telegram webhook route with secret verification"
```

---

## Task 5: Serve the Mini App from the API (static + SPA fallback)

**Files:**
- Create: `apps/api/test/static.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/index.ts`, `apps/api/package.json`

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @spark/api add @fastify/static@^8.0.0
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/static.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";

function buildWithDist(distDir: string) {
  return buildServer({
    db: {} as never,
    telegram: undefined,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    botUsername: "testbot",
    appName: "app",
    webDistDir: distDir,
  } as never);
}

describe("mini app static serving", () => {
  it("serves index.html at / and falls back for SPA routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spark-dist-"));
    writeFileSync(join(dir, "index.html"), "<html><body>SPARK_MINI</body></html>");
    const app = buildWithDist(dir);

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("SPARK_MINI");

    const spa = await app.inject({ method: "GET", url: "/tx/0xabc" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("SPARK_MINI");
  });

  it("keeps unknown /api routes as JSON 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spark-dist-"));
    writeFileSync(join(dir, "index.html"), "SPARK_MINI");
    const app = buildWithDist(dir);
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @spark/api test test/static.test.ts`
Expected: FAIL — root returns 404.

- [ ] **Step 4: Implement static serving**

In `apps/api/src/server.ts`:
Add imports:
```ts
import fastifyStatic from "@fastify/static";
```
Add to `ApiDeps`:
```ts
  webDistDir?: string;
```
In `buildServer`, after `app.get("/health", ...)`, add:
```ts
  if (deps.webDistDir) {
    app.register(fastifyStatic, { root: deps.webDistDir, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }
```

- [ ] **Step 5: Pass the dist dir from the entrypoint**

In `apps/api/src/index.ts`, inside the `deps` object, add:
```ts
  webDistDir: env.WEB_DIST_DIR,
  telegramWebhook:
    env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_WEBAPP_URL
      ? { secret: env.TELEGRAM_WEBHOOK_SECRET, webappUrl: env.TELEGRAM_WEBAPP_URL }
      : undefined,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @spark/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/index.ts apps/api/package.json apps/api/test/static.test.ts pnpm-lock.yaml
git commit -m "feat(api): serve mini app static files with SPA fallback"
```

---

## Task 6: Frontend uses relative `/api`

**Files:**
- Modify: `apps/telegram-mini-app/src/main.ts`, `apps/telegram-mini-app/src/env.d.ts`
- Test: `apps/telegram-mini-app/test/api.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/telegram-mini-app/test/api.test.ts`, inside `describe("buildApiUrl", ...)` add:
```ts
    it("returns a relative path when origin is empty", () => {
      expect(buildApiUrl("", "/api/auth/telegram")).toBe("/api/auth/telegram");
    });
```

- [ ] **Step 2: Run test to verify it passes already**

Run: `pnpm --filter @spark/telegram-mini-app test`
Expected: PASS (`buildApiUrl("", ...)` already yields a relative path).

- [ ] **Step 3: Make the origin optional**

In `apps/telegram-mini-app/src/env.d.ts`, change:
```ts
  readonly VITE_API_ORIGIN: string;
```
to:
```ts
  readonly VITE_API_ORIGIN?: string;
```

In `apps/telegram-mini-app/src/main.ts`, replace lines 6–7:
```ts
const apiOrigin = import.meta.env.VITE_API_ORIGIN;
if (!apiOrigin) throw new Error("VITE_API_ORIGIN not set");
```
with:
```ts
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "";
```

- [ ] **Step 4: Verify build + tests**

Run:
```bash
pnpm --filter @spark/telegram-mini-app typecheck && pnpm --filter @spark/telegram-mini-app test && pnpm --filter @spark/telegram-mini-app build
```
Expected: typecheck clean; tests pass; `dist/` produced.

- [ ] **Step 5: Commit**

```bash
git add apps/telegram-mini-app/src/main.ts apps/telegram-mini-app/src/env.d.ts apps/telegram-mini-app/test/api.test.ts
git commit -m "feat(mini-app): use relative /api origin by default"
```

---

## Task 7: Production esbuild bundle + start script

**Files:**
- Create: `esbuild.config.mjs`, `scripts/start-api.sh`
- Modify: `package.json`

- [ ] **Step 1: Add esbuild**

Run:
```bash
pnpm add -D -w esbuild@^0.24.0
```

- [ ] **Step 2: Create the esbuild config**

Create `esbuild.config.mjs`:
```js
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  external: ["pg-native", "bufferutil", "utf-8-validate", "encoding"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ["apps/api/src/index.ts"], outfile: "apps/api/dist/index.js" });
await build({ ...shared, entryPoints: ["apps/bot/src/index.ts"], outfile: "apps/bot/dist/index.js" });
```

- [ ] **Step 3: Add build scripts**

In root `package.json` `scripts`, add:
```json
    "build": "pnpm build:js && pnpm build:mini",
    "build:js": "node esbuild.config.mjs",
    "build:mini": "pnpm --filter @spark/telegram-mini-app build",
```

- [ ] **Step 4: Verify the bundle builds and boots**

Run:
```bash
pnpm build:js
ls -la apps/api/dist/index.js apps/bot/dist/index.js
```
Expected: both bundles exist.

Boot check (uses the local Postgres from `docker-compose.yml`; start it first if needed):
```bash
pnpm db:up
DATABASE_URL="postgres://spark:spark@localhost:5432/spark" \
  WEB_DIST_DIR="apps/telegram-mini-app/dist" \
  API_PORT=3999 node apps/api/dist/index.js &
sleep 2
curl -s localhost:3999/health
kill %1
```
Expected: `{"status":"ok","service":"spark-api"}` (proves extensionless-import problem is resolved by bundling).

- [ ] **Step 5: Create the start script**

Create `scripts/start-api.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

MIGRATE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}"
echo "[start] applying migrations"
DATABASE_URL="$MIGRATE_URL" pnpm --filter @spark/db db:migrate

echo "[start] launching api"
exec node apps/api/dist/index.js
```
Make it executable:
```bash
chmod +x scripts/start-api.sh
```

- [ ] **Step 6: Commit**

```bash
git add esbuild.config.mjs scripts/start-api.sh package.json pnpm-lock.yaml
git commit -m "build: esbuild bundle for api/bot + migration start script"
```

---

## Task 8: Telegram setup script (webhook + menu button)

**Files:**
- Create: `scripts/telegram-setup.mjs`

- [ ] **Step 1: Create the script**

Create `scripts/telegram-setup.mjs`:
```js
const token = process.env.TELEGRAM_BOT_TOKEN;
const webappUrl = process.env.TELEGRAM_WEBAPP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !webappUrl || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBAPP_URL and TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;

async function call(method, payload) {
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`${method} failed: ${res.status} ${body.description ?? ""}`);
  }
  return body.result;
}

const hookUrl = `${webappUrl.replace(/\/+$/, "")}/api/telegram/webhook`;

await call("setWebhook", { url: hookUrl, secret_token: secret, allowed_updates: ["message"] });
await call("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Open Spark",
    web_app: { url: webappUrl },
  },
});

console.log(`webhook set to ${hookUrl}`);
console.log("menu button set");
```

- [ ] **Step 2: Dry-run against the real bot (after it exists)**

Run (with a test bot token; delete the webhook afterward if not deploying yet):
```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBAPP_URL=https://example.com TELEGRAM_WEBHOOK_SECRET=devsecret \
  node scripts/telegram-setup.mjs
```
Expected: `webhook set to ...` and `menu button set`. (Telegram accepts any HTTPS URL; no server needed to register.)

- [ ] **Step 3: Commit**

```bash
git add scripts/telegram-setup.mjs
git commit -m "chore(telegram): idempotent webhook + menu button setup script"
```

---

## Task 9: Deployment configuration files

**Files:**
- Create: `render.yaml`, `.env.prod.example`, `.node-version`
- Modify: `.gitignore`

- [ ] **Step 1: Create `render.yaml`**

Create `render.yaml`:
```yaml
services:
  - type: web
    name: spark-api
    runtime: node
    plan: free
    region: oregon
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: bash scripts/start-api.sh
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "22.18.0"
      - key: NODE_ENV
        value: production
      - key: WEB_DIST_DIR
        value: apps/telegram-mini-app/dist
      - key: TELEGRAM_APP_NAME
        value: spark
      - key: SESSION_TTL_SECONDS
        value: "2592000"
      - key: MEMBERSHIP_CACHE_TTL_MS
        value: "300000"
      - key: DATABASE_URL
        sync: false
      - key: DATABASE_DIRECT_URL
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_WEBAPP_URL
        sync: false
      - key: TELEGRAM_WEBHOOK_SECRET
        sync: false
```

- [ ] **Step 2: Create `.env.prod.example`**

Create `.env.prod.example`:
```dotenv
# Production (Render) environment shape — placeholders only, never real secrets.
# Set these in the Render dashboard (or via `render.yaml` with sync:false).

NODE_ENV=production
API_PORT=10000
WEB_DIST_DIR=apps/telegram-mini-app/dist

# Neon: pooled URL for the app; direct URL for migrations.
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=require
DATABASE_DIRECT_URL=postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/DB?sslmode=require

# Telegram
TELEGRAM_BOT_TOKEN=000000:REPLACE_ME
TELEGRAM_WEBAPP_URL=https://spark-api.onrender.com
TELEGRAM_WEBHOOK_SECRET=REPLACE_WITH_RANDOM_STRING
TELEGRAM_APP_NAME=spark

SESSION_TTL_SECONDS=2592000
MEMBERSHIP_CACHE_TTL_MS=300000
```

- [ ] **Step 3: Pin Node and allow the env example**

Create `.node-version`:
```
22.18.0
```

In `.gitignore`, after the line `!**/.env.example`, add:
```
!**/.env.prod.example
```

- [ ] **Step 4: Verify the example is tracked**

Run:
```bash
git check-ignore -v .env.prod.example || echo "NOT IGNORED (good)"
```
Expected: `NOT IGNORED (good)` (exit code from check-ignore means it's ignored only if a rule prints).

- [ ] **Step 5: Commit**

```bash
git add render.yaml .env.prod.example .node-version .gitignore
git commit -m "chore(deploy): render blueprint, prod env example, node pin"
```

---

## Task 10: Deployment runbook

**Files:**
- Create: `docs/deploy-render.md`

- [ ] **Step 1: Write the runbook**

Create `docs/deploy-render.md` covering, in order:
1. **Prereqs:** GitHub repo pushed; Render + Neon accounts (no card).
2. **Neon:** create project → copy the **pooled** connection string (`DATABASE_URL`) and the **direct** one (`DATABASE_DIRECT_URL`); both need `sslmode=require`.
3. **BotFather:** `/newbot` → token; set `TELEGRAM_BOT_TOKEN`. Generate a webhook secret: `openssl rand -hex 32` → `TELEGRAM_WEBHOOK_SECRET`.
4. **Render:** New → Blueprint → select repo → apply `render.yaml`; enter the `sync:false` secrets; note the service URL → set `TELEGRAM_WEBAPP_URL=https://<service>.onrender.com`; redeploy.
5. **Register:** `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBAPP_URL=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs`.
6. **Verify:** the acceptance checklist (below).
7. **Backup/restore:**
   - `pg_dump "$DATABASE_DIRECT_URL" > backup.sql`
   - `psql "$DATABASE_DIRECT_URL" < backup.sql`
8. **Troubleshooting:** cold start (~30–60s first load); Neon auto-suspend; `preDeployCommand` alternative for migrations; how to check webhook (`getWebhookInfo`).
9. **Mocked/incomplete:** wallet connect (mocked), settlement (broken/unregistered unless `WALLETCONNECT_*` set), membership (needs channel), worker (not deployed), Arc/real USDC (disabled).

- [ ] **Step 2: Commit**

```bash
git add docs/deploy-render.md
git commit -m "docs: render + neon deployment runbook"
```

---

## Task 11: Local end-to-end verification (before deploying)

**Files:** none (verification only).

- [ ] **Step 1: Full workspace checks**

Run:
```bash
pnpm -r --if-present run typecheck && pnpm -r --if-present run test && pnpm build
```
Expected: typecheck + tests pass; bundles + mini app built.

- [ ] **Step 2: Run the production flow locally**

Run:
```bash
pnpm db:up
pnpm --filter @spark/db db:migrate
WEB_DIST_DIR=apps/telegram-mini-app/dist \
  TELEGRAM_BOT_TOKEN=<test-bot-token> \
  TELEGRAM_WEBAPP_URL=http://localhost:3999 \
  TELEGRAM_WEBHOOK_SECRET=devsecret \
  DATABASE_URL="postgres://spark:spark@localhost:5432/spark" \
  API_PORT=3999 node apps/api/dist/index.js &
```

- [ ] **Step 3: Verify routing, static, and auth**

Run:
```bash
curl -s localhost:3999/health          # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" localhost:3999/          # 200 (mini app)
curl -s -o /dev/null -w "%{http_code}\n" localhost:3999/api/me    # 401
curl -s -X POST localhost:3999/api/telegram/webhook -H 'content-type: application/json' -d '{}'   # 401 (no secret)
curl -s -X POST localhost:3999/api/telegram/webhook -H 'x-telegram-bot-api-secret-token: devsecret' -H 'content-type: application/json' -d '{"message":{"chat":{"id":1},"text":"/start"}}'  # 200
```

- [ ] **Step 4: Verify DB persistence across restart**

Run:
```bash
curl -s -X POST localhost:3999/api/auth/telegram -H 'content-type: application/json' -d '{"initData":"<signed-initdata>"}' | head -c 120
# then restart the node process and confirm users/sessions rows persist
pnpm --filter @spark/db db:migrate
```
Expected: data persists (same Postgres volume).

- [ ] **Step 5: Stop the local stack**

Run: `kill %1; pnpm db:down`

---

## Self-Review Notes (spec coverage)

- Hostname/configurable → `render.yaml` + `TELEGRAM_WEBAPP_URL` env (Task 9).
- Single-origin routing → Tasks 5, 6, 9.
- Production build (compiled JS, no tsx) → Task 7.
- Controlled migrations → Task 7 (`scripts/start-api.sh`), Task 10 (pre-deploy alternative).
- Security (private DB, secrets, sanitized logs) → Tasks 2, 4, 9.
- Bot single instance + menu button + explicit failure → Tasks 2, 4, 8 (one web service).
- Persistence/recovery → Task 10 (Neon + pg_dump/restore), Task 11.
- Oracle → not applicable (Render chosen); ARM/OCI sections dropped.
- Scope guard → Tasks 10, and no settlement/wallet changes.
- Verification → Task 11 + Task 10 checklists.
