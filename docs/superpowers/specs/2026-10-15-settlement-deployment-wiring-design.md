# Settlement Deployment Wiring — Design

Date: 2026-10-15
Status: Approved (design)

## Objective

Make the **already-implemented** Arc reward settlement run in the live deployment.

Phase 5 (`docs/superpowers/specs/2026-10-13-phase5-arc-settlement.md`) is fully
implemented and tested in `worker/`. The only missing piece is that nothing runs
it in production: the worker is not deployed, the API never invokes it, and Render
is missing the Arc/operator environment. This spec covers **deployment wiring and
runs the existing worker code in-process** — it does not reimplement settlement.

## What already exists (do not rebuild)

| Piece | Location | Status |
|-------|----------|--------|
| `runSettlementCycle` (submit + poll) | `worker/src/settlement/index.ts` | done |
| `createOnchainSettlement` (real `SettlementPort`) | `worker/src/settlement/port.ts` | done |
| `runReconciliation` (RewardPaid logs, self-heal) | `worker/src/reconciliation/index.ts` | done |
| `buildRuntime` (operator wallet + clients) | `worker/src/index.ts` | done |
| Seed script (create/approve/fund campaign) | `worker/src/scripts/seed-campaign.ts` | done |
| Reward authorization in prod | `apps/api/src/routes/verify.ts:105` | done |
| Phase 5 tables (`blockchain_transactions`, `campaign_events`, `chain_cursors`, `rewards.on_chain_reward_id`) | `packages/db/drizzle/0000`–`0005` | done |

## Problem statement

- No process runs `runSettlementCycle` / `runReconciliation` in production.
- `apps/api/src/index.ts:32-39` hardcodes a mock `SettlementService`. This is the **user-facing WalletConnect settlement route**, not the reward-payout path. It stays mocked (WalletConnect is disabled) and is **out of scope**.
- Render lacks `ARC_RPC_URL, ARC_CHAIN_ID, ARC_USDC_ADDRESS, ESCROW_ADDRESS, OPERATOR_PRIVATE_KEY, SETTLE_*`.
- `@spark/worker` has no build step and runs raw TS (`node src/main.ts`), which does not work on Node 22 in the deployed image.

## Scope

**In scope**
- Extract a pg-boss-free runtime from `@spark/worker` so the API can reuse the existing settlement/reconciliation functions.
- Run the settler **in-process** inside the API web service: boot reconciliation + interval tick, gated by env.
- A token-gated manual trigger endpoint.
- Env plumbing (API schema, `.env.example`, Render service env).
- A documented, idempotent seed path for the demo campaign + wallet association.

**Out of scope**
- Rewriting settlement logic (already implemented).
- pg-boss / a separate Render worker service (only one free instance is available).
- WalletConnect, the user-facing settlement route, campaign-funding UX, mainnet.
- Contract changes.

## Design

### 1. Worker runtime extraction
Add `worker/src/runtime.ts` — a module that imports **no pg-boss** and exports:
- `buildRuntime(env, db)` (moved from `index.ts`)
- `runSettlementCycle` (re-export from `./settlement`)
- `runReconciliation` (re-export from `./reconciliation`)
- `createOnchainSettlement` (re-export from `./settlement/port`)

`worker/src/index.ts` imports `buildRuntime` from `./runtime` for the pg-boss path and re-exports it, so `main.ts` and existing tests are unchanged.

Extend `worker/package.json` exports:
```json
"exports": {
  ".": "./src/index.ts",
  "./runtime": "./src/runtime.ts",
  "./settlement": "./src/settlement/index.ts"
}
```
This keeps pg-boss out of the API bundle (the API imports only `./runtime`).

### 2. In-process runner in the API
New `apps/api/src/settlement/runner.ts`:
```
createSettlementRunner({ db, env }): { start(), stop(), runOnce() }
```
- Constructs the runtime via `buildRuntime(workerEnv, db)` once.
- `start()`: run `runReconciliation` once on boot, then `setInterval` for settle+reconcile at `SETTLE_INTERVAL_SECONDS` / `RECONCILE_INTERVAL_SECONDS`. Timers are `unref()`ed.
- Overlap guard: an in-flight boolean; a tick that fires while the previous is running is skipped.
- Per-tick errors are caught and logged (structured, no secrets); the loop never crashes the API.
- `runOnce()` runs one settle + reconcile cycle and returns `SettlementCycleStats`, used by the admin endpoint and tests.
- `stop()` clears timers (used in tests).

Wiring in `apps/api/src/index.ts`:
- When `SETTLEMENT_ENABLED` is true and all required vars are present → `runner.start()`.
- When disabled or misconfigured → log a single notice and start nothing (API boots normally).
- The API must **not** import `@spark/worker`'s `index.ts` (avoids pg-boss).

### 3. Admin endpoint
New `apps/api/src/routes/admin.ts`:
- `POST /api/admin/settle` — enabled only when settlement is configured.
- Auth: `X-Admin-Token` header must equal `ADMIN_TOKEN`; constant-time compare.
- Returns the `SettlementCycleStats` from `runOnce()`.
- Returns `404` when settlement is not configured, `401` when the token is wrong/absent.
- Registered only from the settlement bootstrap (not in the WalletConnect-gated block).

### 4. Env & secrets
Extend `apps/api/src/env.ts` (all optional except as noted):
| Var | Default | Notes |
|-----|---------|-------|
| `SETTLEMENT_ENABLED` | `false` | Master gate |
| `ADMIN_TOKEN` | — | Required when enabled |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` | |
| `ARC_CHAIN_ID` | `5042002` | |
| `ARC_USDC_ADDRESS` | `0x3600…0000` | |
| `ESCROW_ADDRESS` | — | Required when enabled |
| `OPERATOR_PRIVATE_KEY` | — | Required when enabled; secret |
| `SETTLE_BATCH_LIMIT` | `25` | |
| `SETTLE_INTERVAL_SECONDS` | `15` | |
| `RECONCILE_INTERVAL_SECONDS` | `30` | |
| `SETTLE_MAX_ATTEMPTS` | `5` | |

Validation: if `SETTLEMENT_ENABLED=true` and any required var is missing/invalid, log the missing names and **do not** start the runner (fail-soft, API stays up). `OPERATOR_PRIVATE_KEY` is never logged. Add these keys to `.env.example`. Sync with `worker/src/env.ts` (single source: the API maps its env into the worker schema).

### 5. Render configuration
Add to the live service env (`srv-db7a4gu01pc73duj120`):
`SETTLEMENT_ENABLED=true`, `ADMIN_TOKEN`, `ARC_RPC_URL`, `ARC_CHAIN_ID`, `ARC_USDC_ADDRESS`, `ESCROW_ADDRESS=0x9539efAFf246799827E6F5E6Cbc475122710Ef64`, `OPERATOR_PRIVATE_KEY` (secret), `SETTLE_*`.
`render.yaml` (documentation-only) is updated to match. No new service, no worker dyno.

### 6. Build
No change to `esbuild.config.mjs` beyond what falls out of the new import: bundling `apps/api/src/index.ts` now also bundles the imported `worker/src/runtime.ts` and its deps (viem, `@spark/arc`, `@spark/ledger`). pg-boss is not pulled in. `pnpm build` remains the build command.

### 7. Seed path (operational, idempotent)
Documented steps (run with the worker seed script; env from `.env` / Neon direct URL):
1. Create a demo campaign + participation through the API so a reward reaches `AUTHORIZED` (or seed fixtures directly).
2. `pnpm --filter @spark/worker seed:campaign <campaign-uuid> <budgetMicroUsdc>` → creates + funds the on-chain campaign and writes `campaigns.on_chain_campaign_id`.
   - Idempotency: skip if `on_chain_campaign_id` is already set (documented guard; re-running on a fresh campaign id is a no-op).
- Insert a `wallet_association` for the demo user so the reward is not held (recipient resolution uses `wallet_associations`).
- Re-running the seed does not create duplicates for the same campaign.

## Idempotency & failure behavior
No new logic; inherits Phase 5 guarantees:
- Contract replay maps + `blockchain_transactions.transaction_hash` unique + ledger `idempotency_key` unique.
- Overlapping ticks guarded in-process; a restart reconciles `SUBMITTED` rewards via receipts on boot.
- No-wallet → held (`AUTHORIZED`); reverted → `FAILED`; dropped → `RETRYING` to `SETTLE_MAX_ATTEMPTS` then `FAILED`.
- Render free tier sleeping pauses the loop; boot reconciliation closes the gap.

## Testing
- `apps/api`: runner unit tests with a fake runtime (no network) — start/stop, overlap guard, per-tick error isolation, `runOnce` stats, disabled-by-default.
- `apps/api`: admin route tests — 404 when unconfigured, 401 on missing/wrong token, 200 with stats.
- `apps/api`: env schema tests — enabled+missing-required does not start the runner.
- `worker`: existing suite must stay green after the `runtime.ts` extraction (no behavior change).
- Manual testnet E2E (documented): seed campaign → participate → `POST /api/admin/settle` → assert on-chain `RewardPaid`, reward `PAID`, ledger entry, and a second run is idempotent.

## Risks & prerequisites
1. **Test USDC (blocking for E2E, not for build):** funding the escrow requires test USDC at `0x3600…0000` for the operator `0xfB4d…`. The seed script must assert sufficient balance and abort with a clear message; the funding source (faucet / pre-funded) is an operational prerequisite.
2. **Recipient wallet:** no production path sets a wallet today (`wallet_associations` is only written in tests). The demo requires inserting one; without it rewards are held, not failed.
3. **Free-tier sleep:** settlement pauses while the service is asleep; acceptable for the demo, covered by boot reconciliation.

## Definition of Done
- With `SETTLEMENT_ENABLED=true` and Render env set, an `AUTHORIZED` reward for a user with an associated wallet is paid on-chain on Arc testnet: `RewardPaid` observed, reward `PAID`, ledger entry written.
- `POST /api/admin/settle` returns stats; a repeated call neither double-pays nor errors.
- Disabling `SETTLEMENT_ENABLED` makes the API boot with no settlement activity.
- API and all workspace tests pass offline; the worker suite is unchanged and green.

## File-by-file changes
- `worker/src/runtime.ts` — new (pg-boss-free runtime).
- `worker/src/index.ts` — import `buildRuntime` from `./runtime`; re-export.
- `worker/package.json` — add `./runtime` export.
- `apps/api/src/settlement/runner.ts` — new in-process runner.
- `apps/api/src/routes/admin.ts` — new token-gated trigger.
- `apps/api/src/server.ts` — register admin route when a runner is provided (add `admin` + `settlementRunner` to deps).
- `apps/api/src/index.ts` — build + start runner when enabled; keep mock `SettlementService` as-is.
- `apps/api/src/env.ts`, `.env.example`, `render.yaml` — env plumbing.
- `docs/deploy-render.md`: settlement env + seed runbook.
