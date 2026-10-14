# Settlement Deployment Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the already-implemented Arc settlement worker in-process inside the deployed API so AUTHORIZED rewards are paid on-chain via the operator EOA on Arc testnet, confirming before marking PAID.

**Architecture:** Extract a pg-boss-free runtime from `@spark/worker` (`worker/src/runtime.ts`). The API builds that runtime from env (gated by `SETTLEMENT_ENABLED`), wraps the existing `runSettlementCycle` / `runReconciliation` in an overlap-guarded in-process interval runner, and exposes a token-gated `POST /api/admin/settle`. No settlement logic is rewritten.

**Tech Stack:** TypeScript, Node 22, Fastify, zod, viem, vitest, pg-boss (kept only for the standalone worker path), pnpm workspaces, esbuild bundling.

**Spec:** `docs/superpowers/specs/2026-10-15-settlement-deployment-wiring-design.md`

---

## Conventions

- Run a single test file: `pnpm --filter <pkg> exec vitest run <path>` (from repo root).
- DB-backed tests use the shared harness (`packages/db/test/harness.ts`) which needs a local Postgres on port `5433` (`pnpm db:up`).
- Commit after each task. Message style: `feat(scope): …` / `test(scope): …` / `docs: …`.

---

## Task 1: Extract a pg-boss-free worker runtime

**Files:**
- Create: `worker/src/runtime.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/package.json`
- Test: `worker/test/runtime.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `worker/test/runtime.test.ts`:

```ts
import type { Db } from "@spark/db";
import { describe, expect, it } from "vitest";
import { buildRuntime, runReconciliation, runSettlementCycle } from "../src/runtime";
import type { WorkerEnv } from "../src/env";

const env: WorkerEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://spark:spark@localhost:5433/spark",
  ARC_NETWORK: "testnet",
  ARC_RPC_URL: "https://rpc.testnet.arc.io",
  ARC_CHAIN_ID: 5042002,
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  ESCROW_ADDRESS: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64",
  OPERATOR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  SETTLE_BATCH_LIMIT: 25,
  SETTLE_INTERVAL_SECONDS: 15,
  RECONCILE_INTERVAL_SECONDS: 30,
  SETTLE_MAX_ATTEMPTS: 5,
};

describe("worker runtime", () => {
  it("re-exports the settlement + reconciliation functions", () => {
    expect(typeof runSettlementCycle).toBe("function");
    expect(typeof runReconciliation).toBe("function");
  });

  it("builds a runtime without network calls", () => {
    const { deps, intervals } = buildRuntime(env, {} as Db);
    expect(typeof deps.settlement.submitPayout).toBe("function");
    expect(deps.escrowAddress).toBe(env.ESCROW_ADDRESS);
    expect(deps.chainId).toBe(5042002);
    expect(intervals).toEqual({ settleSeconds: 15, reconcileSeconds: 30 });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @spark/worker exec vitest run test/runtime.test.ts`
Expected: FAIL — cannot resolve `../src/runtime`.

- [ ] **Step 3: Create `worker/src/runtime.ts`**

```ts
import type { PublicClient } from "viem";
import { ARC_MIN_MAX_FEE_PER_GAS_WEI, createArcPublicClient } from "@spark/arc";
import type { Db } from "@spark/db";
import { type Address, createViemWalletProvider } from "@spark/wallet";
import type { WorkerEnv } from "./env";
import { createOnchainSettlement } from "./settlement/port";

export { workerEnvSchema } from "./env";
export type { WorkerEnv } from "./env";
export { runSettlementCycle } from "./settlement";
export { runReconciliation } from "./reconciliation";
export { createOnchainSettlement } from "./settlement/port";

export interface WorkerRuntimeDeps {
  db: Db;
  settlement: ReturnType<typeof createOnchainSettlement>;
  escrowAddress: Address;
  chainId: number;
  publicClient: Pick<PublicClient, "getBlockNumber" | "getLogs">;
  batchLimit: number;
  maxAttempts: number;
}

export function buildRuntime(
  env: WorkerEnv,
  db: Db,
): {
  deps: WorkerRuntimeDeps;
  intervals: { settleSeconds: number; reconcileSeconds: number };
} {
  const wallet = createViemWalletProvider({
    rpcUrl: env.ARC_RPC_URL,
    chainId: env.ARC_CHAIN_ID,
    privateKey: env.OPERATOR_PRIVATE_KEY as `0x${string}`,
    minMaxFeePerGasWei: ARC_MIN_MAX_FEE_PER_GAS_WEI,
  });
  const settlement = createOnchainSettlement({
    wallet,
    escrowAddress: env.ESCROW_ADDRESS as Address,
  });
  const publicClient = createArcPublicClient(env.ARC_RPC_URL, env.ARC_CHAIN_ID);
  return {
    deps: {
      db,
      settlement,
      escrowAddress: env.ESCROW_ADDRESS as Address,
      chainId: env.ARC_CHAIN_ID,
      publicClient,
      batchLimit: env.SETTLE_BATCH_LIMIT,
      maxAttempts: env.SETTLE_MAX_ATTEMPTS,
    },
    intervals: {
      settleSeconds: env.SETTLE_INTERVAL_SECONDS,
      reconcileSeconds: env.RECONCILE_INTERVAL_SECONDS,
    },
  };
}
```

- [ ] **Step 4: Slim `worker/src/index.ts` to import from `./runtime`**

Replace the whole file with:

```ts
import PgBoss from "pg-boss";
import { intervalToCron } from "./cron";
import { QUEUES } from "./queues";
import { runReconciliation } from "./reconciliation";
import { runSettlementCycle } from "./settlement";
import type { WorkerRuntimeDeps } from "./runtime";

export { buildRuntime } from "./runtime";
export type { WorkerRuntimeDeps } from "./runtime";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

export async function registerWorkers(
  boss: PgBoss,
  deps: WorkerRuntimeDeps,
  intervals: { settleSeconds: number; reconcileSeconds: number },
): Promise<void> {
  await boss.createQueue(QUEUES.settlement);
  await boss.createQueue(QUEUES.reconciliation);

  await boss.work(QUEUES.settlement, async () => {
    await runSettlementCycle({
      db: deps.db,
      settlement: deps.settlement,
      limit: deps.batchLimit,
      maxAttempts: deps.maxAttempts,
    });
  });

  await boss.work(QUEUES.reconciliation, async () => {
    await runReconciliation({
      db: deps.db,
      publicClient: deps.publicClient,
      escrowAddress: deps.escrowAddress,
      chainId: deps.chainId,
    });
  });

  await boss.schedule(QUEUES.settlement, intervalToCron(intervals.settleSeconds));
  await boss.schedule(QUEUES.reconciliation, intervalToCron(intervals.reconcileSeconds));
}

export async function start(
  connectionString: string,
  deps: WorkerRuntimeDeps,
  intervals: { settleSeconds: number; reconcileSeconds: number },
): Promise<PgBoss> {
  const boss = createBoss(connectionString);
  await boss.start();
  await registerWorkers(boss, deps, intervals);
  return boss;
}
```

- [ ] **Step 5: Add the `./runtime` export to `worker/package.json`**

```json
"exports": {
  ".": "./src/index.ts",
  "./runtime": "./src/runtime.ts",
  "./settlement": "./src/settlement/index.ts"
}
```

- [ ] **Step 6: Run the worker suite (existing tests must stay green)**

Run: `pnpm --filter @spark/worker test`
Expected: `runtime.test.ts` passes; `worker.test.ts`, `settlement.test.ts`, `settlement-port.test.ts`, `reconciliation.test.ts`, `cron.test.ts`, `env.test.ts` still pass (integration file is skipped unless `RUN_ARC_INTEGRATION=1`).

- [ ] **Step 6b: Typecheck the worker**

Run: `pnpm --filter @spark/worker typecheck`
Expected: exit 0. If `main.ts` referenced `buildRuntime` from `.` it still resolves via the re-export above (main.ts already imports from `./index`).

- [ ] **Step 7: Commit**

```bash
git add worker/src/runtime.ts worker/src/index.ts worker/package.json worker/test/runtime.test.ts
git commit -m "refactor(worker): extract pg-boss-free runtime module"
```

---

## Task 2: API settlement config loader

**Files:**
- Modify: `apps/api/package.json` (add `@spark/worker`)
- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/settlement/config.ts`
- Test: `apps/api/test/settlementConfig.test.ts`

- [ ] **Step 1: Add the workspace dependency**

In `apps/api/package.json` `dependencies`, add:

```json
"@spark/worker": "workspace:*",
```

Then run: `pnpm install --frozen-lockfile=false`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/settlementConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { loadSettlementConfig } from "../src/settlement/config";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://spark:spark@localhost:5433/spark",
  ESCROW_ADDRESS: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64",
  OPERATOR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  ADMIN_TOKEN: "secret",
};

describe("loadSettlementConfig", () => {
  it("is disabled by default", () => {
    expect(loadSettlementConfig(loadEnv(base)).status).toBe("disabled");
  });

  it("is misconfigured when enabled but required vars are missing", () => {
    const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true", OPERATOR_PRIVATE_KEY: undefined });
    const result = loadSettlementConfig(env);
    expect(result.status).toBe("misconfigured");
    if (result.status === "misconfigured") expect(result.missing).toContain("OPERATOR_PRIVATE_KEY");
  });

  it("is ready when enabled with all required vars", () => {
    const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true" });
    const result = loadSettlementConfig(env);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.config.adminToken).toBe("secret");
      expect(result.config.workerEnv.ESCROW_ADDRESS).toBe(base.ESCROW_ADDRESS);
      expect(result.config.workerEnv.ARC_CHAIN_ID).toBe(5042002);
    }
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @spark/api exec vitest run test/settlementConfig.test.ts`
Expected: FAIL — cannot resolve `../src/settlement/config`.

- [ ] **Step 4: Extend `apps/api/src/env.ts`**

Add these keys inside `envSchema` (note `SETTLEMENT_ENABLED` uses an enum transform because `z.coerce.boolean()` treats the string `"false"` as `true`):

```ts
  SETTLEMENT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ADMIN_TOKEN: z.string().min(1).optional(),
  ARC_RPC_URL: z.string().url().optional(),
  ARC_CHAIN_ID: z.coerce.number().int().positive().optional(),
  ARC_USDC_ADDRESS: z.string().optional(),
  ESCROW_ADDRESS: z.string().optional(),
  OPERATOR_PRIVATE_KEY: z.string().optional(),
  SETTLE_BATCH_LIMIT: z.coerce.number().int().positive().optional(),
  SETTLE_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  SETTLE_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
```

- [ ] **Step 5: Create `apps/api/src/settlement/config.ts`**

```ts
import { type WorkerEnv, workerEnvSchema } from "@spark/worker/runtime";
import type { Env } from "../env";

export interface SettlementConfig {
  workerEnv: WorkerEnv;
  adminToken: string;
}

export type SettlementConfigResult =
  | { status: "disabled" }
  | { status: "misconfigured"; missing: string[] }
  | { status: "ready"; config: SettlementConfig };

export function loadSettlementConfig(env: Env): SettlementConfigResult {
  if (!env.SETTLEMENT_ENABLED) return { status: "disabled" };

  const parsed = workerEnvSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL,
    ARC_NETWORK: env.ARC_NETWORK,
    ARC_RPC_URL: env.ARC_RPC_URL,
    ARC_CHAIN_ID: env.ARC_CHAIN_ID,
    ARC_USDC_ADDRESS: env.ARC_USDC_ADDRESS,
    ESCROW_ADDRESS: env.ESCROW_ADDRESS,
    OPERATOR_PRIVATE_KEY: env.OPERATOR_PRIVATE_KEY,
    SETTLE_BATCH_LIMIT: env.SETTLE_BATCH_LIMIT,
    SETTLE_INTERVAL_SECONDS: env.SETTLE_INTERVAL_SECONDS,
    RECONCILE_INTERVAL_SECONDS: env.RECONCILE_INTERVAL_SECONDS,
    SETTLE_MAX_ATTEMPTS: env.SETTLE_MAX_ATTEMPTS,
  });

  const missing: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) missing.push(issue.path.join("."));
  }
  if (!env.ADMIN_TOKEN) missing.push("ADMIN_TOKEN");
  if (missing.length > 0 || !parsed.success) {
    return { status: "misconfigured", missing };
  }
  return { status: "ready", config: { workerEnv: parsed.data, adminToken: env.ADMIN_TOKEN } };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @spark/api exec vitest run test/settlementConfig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/env.ts apps/api/src/settlement/config.ts apps/api/test/settlementConfig.test.ts pnpm-lock.yaml
git commit -m "feat(api): settlement env + config loader (fail-soft)"
```

---

## Task 2b: Export the worker env schema from the runtime

**Files:**
- Modify: `worker/src/runtime.ts`
- Test: `worker/test/runtime.test.ts`

- [ ] **Step 1: Add a failing assertion**

Append inside the `describe` in `worker/test/runtime.test.ts`:

```ts
  it("re-exports workerEnvSchema", async () => {
    const mod = await import("../src/runtime");
    expect(typeof mod.workerEnvSchema.safeParse).toBe("function");
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @spark/worker exec vitest run test/runtime.test.ts`
Expected: FAIL — `workerEnvSchema` is not exported.

- [ ] **Step 3: Re-export the schema**

At the top of `worker/src/runtime.ts`, add:

```ts
export { workerEnvSchema } from "./env";
export type { WorkerEnv } from "./env";
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @spark/worker exec vitest run test/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/runtime.ts worker/test/runtime.test.ts
git commit -m "feat(worker): export workerEnvSchema from runtime"
```

> Note: Task 2's `config.ts` imports `workerEnvSchema` from `@spark/worker/runtime`; run Task 2b before Task 2's Step 5 if executing in order.

---

## Task 3: In-process settlement runner (pure, injectable timers)

**Files:**
- Create: `apps/api/src/settlement/runner.ts`
- Test: `apps/api/test/settlementRunner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/settlementRunner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSettlementRunner } from "../src/settlement/runner";

function fakeTimers() {
  const callbacks: Array<() => void> = [];
  const cleared: unknown[] = [];
  return {
    setIntervalFn: ((fn: () => void) => {
      callbacks.push(fn);
      return { unref() {} } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval,
    clearIntervalFn: ((id: unknown) => {
      cancelled.push(id);
    }) as unknown as typeof clearInterval,
    fire: () => Promise.all(callbacks.map((cb) => Promise.resolve(cb()))),
  };
}

describe("createSettlementRunner", () => {
  it("runs one settle + reconcile per runOnce and returns both results", async () => {
    const events: string[] = [];
    const runner = createSettlementRunner({
      settle: async () => {
        events.push("settle");
        return { submitted: 1 };
      },
      reconcile: async () => {
        events.push("reconcile");
        return { healed: 0 };
      },
      settleIntervalMs: 1000,
      reconcileIntervalMs: 1000,
    });
    const stats = await runner.runOnce();
    expect(events).toEqual(["settle", "reconcile"]);
    expect(stats).toEqual({ settle: { submitted: 1 }, reconcile: { healed: 0 } });
  });

  it("guards against overlapping ticks", async () => {
    let settleCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const callbacks: Array<() => void> = [];
    const runner = createSettlementRunner({
      settle: async () => {
        settleCalls += 1;
        await gate;
        return {};
      },
      reconcile: async () => ({}),
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    });
    runner.start();
    const tick = callbacks[0];
    tick?.();
    tick?.();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(settleCalls).toBe(1);
    runner.stop();
  });

  it("isolates tick errors and keeps running", async () => {
    const errors: unknown[] = [];
    const callbacks: Array<() => void> = [];
    const runner = createSettlementRunner({
      settle: async () => {
        throw new Error("boom");
      },
      reconcile: async () => ({}),
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      logger: (event, meta) => errors.push({ event, meta }),
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    });
    runner.start();
    callbacks[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors.some((e) => (e as { event: string }).event === "settlement.tick_error")).toBe(true);
    runner.stop();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @spark/api exec vitest run test/settlementRunner.test.ts`
Expected: FAIL — cannot resolve `../src/settlement/runner`.

- [ ] **Step 3: Implement `apps/api/src/settlement/runner.ts`**

```ts
export type TickKind = "settle" | "reconcile";

export interface SettlementRunnerConfig {
  settle: () => Promise<unknown>;
  reconcile: () => Promise<unknown>;
  settleIntervalMs: number;
  reconcileIntervalMs: number;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface SettlementRunner {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<{ settle: unknown; reconcile: unknown }>;
}

export function createSettlementRunner(cfg: SettlementRunnerConfig): SettlementRunner {
  const setInt = cfg.setIntervalFn ?? setInterval;
  const clearInt = cfg.clearIntervalFn ?? clearInterval;
  const timers: Array<ReturnType<typeof setInterval>> = [];
  let inFlight = false;

  async function guarded(kind: TickKind, fn: () => Promise<unknown>): Promise<void> {
    if (inFlight) {
      cfg.logger?.("settlement.tick_skipped", { kind });
      return;
    }
    inFlight = true;
    try {
      await fn();
    } catch (err) {
      cfg.logger?.("settlement.tick_error", { kind, error: String(err) });
    } finally {
      inFlight = false;
    }
  }

  return {
    async runOnce() {
      return { settle: await cfg.settle(), reconcile: await cfg.reconcile() };
    },
    start() {
      void guarded("reconcile", cfg.reconcile);
      const settleTimer = setInt(() => void guarded("settle", cfg.settle), cfg.settleIntervalMs);
      const reconcileTimer = setInt(
        () => void guarded("reconcile", cfg.reconcile),
        cfg.reconcileIntervalMs,
      );
      settleTimer.unref?.();
      reconcileTimer.unref?.();
      timers.push(settleTimer, reconcileTimer);
    },
    stop() {
      for (const timer of timers) clearInt(timer);
      timers.length = 0;
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @spark/api exec vitest run test/settlementRunner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/settlement/runner.ts apps/api/test/settlementRunner.test.ts
git commit -m "feat(api): in-process settlement runner with overlap guard"
```

---

## Task 4: Token-gated admin trigger route

**Files:**
- Create: `apps/api/src/routes/admin.ts`
- Test: `apps/api/test/admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin.test.ts`:

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAdminRoutes } from "../src/routes/admin";

async function build(runnerRunOnce: () => Promise<unknown>) {
  const app = Fastify();
  registerAdminRoutes(app, {   runner: { runOnce }, adminToken: "secret" });
  await app.ready();
  return app;
}

describe("POST /api/admin/settle", () => {
  it("returns 401 without a token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({ method: "POST", url: "/api/admin/settle" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with the wrong token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the cycle stats with the right token", async () => {
    const app = await build(async () => ({ submitted: 2, confirmed: 2 }));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "secret" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", stats: { submitted: 2, confirmed: 2 } });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @spark/api exec vitest run test/admin.test.ts`
Expected: FAIL — cannot resolve `../src/routes/admin`.

- [ ] **Step 3: Implement `apps/api/src/routes/admin.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export interface AdminRouteDeps {
  runner: { runOnce: () => Promise<unknown> };
  adminToken: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  app.post("/api/admin/settle", async (request, reply) => {
    const token = request.headers["x-admin-token"];
    if (typeof token !== "string" || !safeEqual(token, deps.adminToken)) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const stats = await deps.runner.runOnce();
    return reply.send({ status: "ok", stats });
  });
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @spark/api exec vitest run test/admin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test/admin.test.ts
git commit -m "feat(api): token-gated POST /api/admin/settle"
```

---

## Task 4b: Register the admin route in the server

**Files:**
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/server.test.ts` (new case)

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/server.test.ts` (append a `describe("admin route", …)`) using a minimal deps object:

```ts
it("registers the admin settle route when a runner is provided", async () => {
  const app = buildServer({
    db: {} as never,
    telegram: undefined,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 60,
    nodeEnv: "test",
    botUsername: "bot",
    appName: "app",
    admin: { runner: { runOnce: async () => ({ submitted: 0 }) }, adminToken: "secret" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/settle",
    headers: { "x-admin-token": "secret" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().stats).toEqual({ submitted: 0 });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @spark/api exec vitest run test/server.test.ts`
Expected: FAIL — 404 (route not registered) or type error on `admin`.

- [ ] **Step 3: Add the dep + registration in `apps/api/src/server.ts`**

Add to `ApiDeps`:

```ts
  admin?: { runner: { runOnce: () => Promise<unknown> }; adminToken: string };
```

Add the import:

```ts
import { registerAdminRoutes } from "./routes/admin";
```

Inside the `app.register(async (instance) => { … })` block, after `registerTelegramWebhookRoutes(instance, deps);`, add:

```ts
    if (deps.admin) {
      registerAdminRoutes(instance, deps.admin);
    }
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @spark/api exec vitest run test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/test/server.test.ts
git commit -m "feat(api): register admin settle route when configured"
```

---

## Task 5: Bootstrap the runner in the API entrypoint

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Wire the bootstrap**

In `apps/api/src/index.ts`, add imports:

```ts
import { buildRuntime, runReconciliation, runSettlementCycle } from "@spark/worker/runtime";
import { loadSettlementConfig } from "./settlement/config";
import { createSettlementRunner } from "./settlement/runner";
```

After `const deps: Parameters<typeof buildServer>[0] = { … };` (before `buildServer`), add:

```ts
const settlementConfig = loadSettlementConfig(env);
if (settlementConfig.status === "misconfigured") {
  console.warn(
    `settlement: SETTLEMENT_ENABLED=true but missing/invalid config: ${settlementConfig.missing.join(", ")}`,
  );
}
if (settlementConfig.status === "ready") {
  const { deps: runtime, intervals } = buildRuntime(settlementConfig.config.workerEnv, db);
  const runner = createSettlementRunner({
    settle: () =>
      runSettlementCycle({
        db,
        settlement: runtime.settlement,
        limit: runtime.batchLimit,
        maxAttempts: runtime.maxAttempts,
      }),
    reconcile: () =>
      runReconciliation({
        db,
        publicClient: runtime.publicClient,
        escrowAddress: runtime.escrowAddress,
        chainId: runtime.chainId,
      }),
    settleIntervalMs: intervals.settleSeconds * 1000,
    reconcileIntervalMs: intervals.reconcileSeconds * 1000,
    logger: (event, meta) => console.warn(`settlement: ${event}`, meta ?? {}),
  });
  runner.start();
  deps.admin = { runner, adminToken: settlementConfig.config.adminToken };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @spark/api typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Verify the API bundle excludes pg-boss**

Run: `node esbuild.config.mjs && node -e "const s=require('fs').readFileSync('apps/api/dist/index.js','utf8'); if(s.includes('pg-boss')) { console.error('pg-boss leaked into api bundle'); process.exit(1); } console.log('api bundle clean')"`
Expected: prints `api bundle clean`.

- [ ] **Step 4: Smoke test the disabled path**

Run: `SETTLEMENT_ENABLED=false DATABASE_URL=postgres://spark:spark@localhost:5433/spark API_PORT=3999 timeout 5 node apps/api/dist/index.js || true`
Expected: API starts and logs listening; no `settlement:` crash. (Requires `pnpm db:up` and migrations; if Postgres is unavailable, a connection error is acceptable for this smoke check.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): start in-process settlement runner when enabled"
```

---

## Task 5b: Associate-wallet script (unblocks payouts)

**Files:**
- Create: `worker/src/scripts/associate-wallet.ts`
- Test: `worker/test/associate-wallet.test.ts`
- Modify: `worker/package.json` (script entry)

- [ ] **Step 1: Write the failing test**

Create `worker/test/associate-wallet.test.ts`:

```ts
import {
  createCampaign,
  type Db,
  findActiveWalletByCampaignAndUser,
  upsertUserByTelegramId,
} from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { associateWallet } from "../src/scripts/associate-wallet";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("associateWallet", () => {
  it("creates the user if missing and stores a normalized association", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 9811n });
    const campaign = await createCampaign(db, {
      publicId: "assocwallet00001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    await associateWallet(db, {
      campaignId: campaign.id,
      telegramUserId: 9812n,
      address: "0xAbC0000000000000000000000000000000000001",
    });
    const user = await upsertUserByTelegramId(db, { telegramUserId: 9812n });
    const assoc = await findActiveWalletByCampaignAndUser(db, campaign.id, user.id);
    expect(assoc?.normalizedAddress).toBe("0xabc0000000000000000000000000000000000001");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm db:up && pnpm db:migrate`
Then: `pnpm --filter @spark/worker exec vitest run test/associate-wallet.test.ts`
Expected: FAIL — cannot resolve `../src/scripts/associate-wallet`.

- [ ] **Step 3: Implement `worker/src/scripts/associate-wallet.ts`**

```ts
import { createDb, upsertUserByTelegramId, upsertWalletAssociation, type Db } from "@spark/db";
import { loadWorkerEnv } from "../env";

export async function associateWallet(
  db: Db,
  input: { campaignId: string; telegramUserId: bigint; address: string },
): Promise<void> {
  const user = await upsertUserByTelegramId(db, { telegramUserId: input.telegramUserId });
  await upsertWalletAssociation(db, {
    campaignId: input.campaignId,
    userId: user.id,
    address: input.address,
    normalizedAddress: input.address.toLowerCase(),
  });
}

async function main(): Promise<void> {
  const [campaignDbId, telegramUserIdRaw, address] = process.argv.slice(2);
  if (!campaignDbId || !telegramUserIdRaw || !address) {
    throw new Error(
      "usage: node src/scripts/associate-wallet.ts <campaign-db-uuid> <telegram-user-id> <0x-address>",
    );
  }
  const env = loadWorkerEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  await associateWallet(db, {
    campaignId: campaignDbId,
    telegramUserId: BigInt(telegramUserIdRaw),
    address,
  });
  console.info(`associated wallet ${address} with user ${telegramUserIdRaw} on campaign ${campaignDbId}`);
  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add the script to `worker/package.json`**

```json
"associate:wallet": "node src/scripts/associate-wallet.ts",
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @spark/worker exec vitest run test/associate-wallet.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/scripts/associate-wallet.ts worker/test/associate-wallet.test.ts worker/package.json
git commit -m "feat(worker): associate-wallet helper script + test"
```

---

## Task 6: Env plumbing, Render config, and runbook

**Files:**
- Modify: `.env.example`
- Modify: `render.yaml`
- Modify: `docs/deploy-render.md`

- [ ] **Step 1: Add the settlement vars to `.env.example`**

Append:

```bash
# Settlement runner (in-process in the API; disabled by default)
SETTLEMENT_ENABLED=false
ADMIN_TOKEN=
SETTLE_INTERVAL_SECONDS=15
RECONCILE_INTERVAL_SECONDS=30
```

(`ARC_*`, `ESCROW_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `SETTLE_BATCH_LIMIT`, `SETTLE_MAX_ATTEMPTS` are already documented in `.env.example`.)

- [ ] **Step 2: Mirror in `render.yaml` (documentation-only)**

Add to the service `envVars` block:

```yaml
      - key: SETTLEMENT_ENABLED
        value: "true"
      - key: SETTLE_INTERVAL_SECONDS
        value: "15"
      - key: RECONCILE_INTERVAL_SECONDS
        value: "30"
      - key: ARC_RPC_URL
        value: https://rpc.testnet.arc.io
      - key: ARC_CHAIN_ID
        value: "5042002"
      - key: ARC_USDC_ADDRESS
        value: "0x3600000000000000000000000000000000000000"
      - key: ESCROW_ADDRESS
        value: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64"
      - key: ADMIN_TOKEN
        sync: false
      - key: OPERATOR_PRIVATE_KEY
        sync: false
```

- [ ] **Step 3: Add a settlement runbook to `docs/deploy-render.md`**

Append a section:

```markdown
## On-chain settlement (operator EOA)

Prerequisites:
- Operator `0xfB4d…` funded with test USDC at `0x3600…0000` on Arc testnet.
- A campaign with `on_chain_campaign_id` set (via the seed script) and a
  `wallet_association` for the payout recipient.

Set on the Render service `srv-db7a4gu01pc73duj120`: `SETTLEMENT_ENABLED=true`,
`ADMIN_TOKEN`, `ARC_RPC_URL`, `ARC_CHAIN_ID`, `ARC_USDC_ADDRESS`, `ESCROW_ADDRESS`,
`OPERATOR_PRIVATE_KEY` (secret), `SETTLE_INTERVAL_SECONDS`, `RECONCILE_INTERVAL_SECONDS`.

Seed and associate (run locally against the prod DATABASE_URL):
```
pnpm --filter @spark/worker seed:campaign <campaign-uuid> 1000000
node worker/src/scripts/associate-wallet.ts <campaign-uuid> <telegram-user-id> 0x<recipient>
```

Trigger and verify:
```
curl -X POST https://spark-api-ksgo.onrender.com/api/admin/settle -H "x-admin-token: $ADMIN_TOKEN"
```
Expect a reward to move `AUTHORIZED → SUBMITTED → CONFIRMED → PAID` and a `RewardPaid`
log on Arc testnet.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example render.yaml docs/deploy-render.md
git commit -m "docs(deploy): settlement env + operator runbook"
```

---

## Task 8: Full verification

- [ ] **Step 1: Lint, typecheck, and test the whole workspace**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `apps/api/dist/index.js` and `apps/bot/dist/index.js` emitted; mini-app builds.

- [ ] **Step 3: Confirm no secrets are tracked**

Run: `git grep -n "OPERATOR_PRIVATE_KEY=0x" -- . ':!*.example' || echo "no committed operator key"`
Expected: `no committed operator key`.

- [ ] **Step 4: Manual E2E (documented, requires funded operator)**

1. Create a demo campaign + verified participation so a reward reaches `AUTHORIZED`.
2. `pnpm --filter @spark/worker seed:campaign <campaign-uuid> 1000000`
3. `node worker/src/scripts/associate-wallet.ts <campaign-uuid> <telegram-user-id> 0x<recipient>`
4. `curl -X POST https://spark-api-ksgo.onrender.com/api/admin/settle -H "x-admin-token: $ADMIN_TOKEN"`
5. Assert: reward `PAID` in Postgres; `RewardPaid` on the Arc explorer; a second identical call is a no-op and returns without error.

- [ ] **Step 5: Commit any runbook fixes**

```bash
git add -A
git commit -m "chore: settlement verification fixes" || echo "nothing to commit"
```
