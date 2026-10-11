# Architecture

## System mapping

| Layer | Responsibility |
|---|---|
| Telegram | identity, distribution, verification |
| Backend (API + worker) | campaign, eligibility, reward logic |
| `CampaignEscrow` (Arc) | financial enforcement |
| Arc | settlement |
| USDC | campaign budget + reward asset |

## Compute model

- **`apps/api`** — Fastify HTTP API. Authoritative for verification and reward *creation*. Holds no private keys except the operator signer (worker-side only).
- **`worker/`** — background jobs via pg-boss:
  - `settlement` — authorize + submit `payReward`, watch confirmation.
  - `reconciliation` — match on-chain events to ledger, detect dropped txs.
- **Postgres 17** — source of truth for campaign/participation/reward/ledger state. Drizzle migrations under `packages/db`.

## Package seams

- `@spark/wallet` exposes the `WalletProvider` port; the only implementation is a **viem EOA** (Phase 0 decision — Circle wallets cannot submit Arc mainnet contract calls).
- `@spark/arc` owns chain constants and the USDC/fee/emitter rules.
- `@spark/domain` owns money (`MicroUsdc` bigint) and state transitions shared by API and worker.

## Data layer (Phase 1)

- Single Postgres 17 database (`packages/db`); 12 tables: campaign/participation/reward/ledger/verification/settlement state, `users` (Telegram identity), `sessions` (opaque auth), `wallets`, `campaign_events`, `creator_funding_handoffs`.
- All money is integer micro-USDC (`bigint`), matching `@spark/domain.MicroUsdc`.
- `ledger_entries` is **append-only**: a `reject_ledger_mutation()` trigger rejects UPDATE/DELETE, so settlement history is immutable (server audit trail; `docs/SECURITY.md`).
- Identity fields are **server-derived**: the client sends only Telegram `initData`; the API validates the HMAC, upserts `users` by `telegram_user_id`, and issues a 256-bit random session token. Only `sha256(token)` is persisted in `sessions` (PRD §53–54).
- Migrations are plain SQL under `packages/db/drizzle`; `pnpm db:migrate` applies them. Integration tests run against an ephemeral Testcontainers `postgres:17`.

## Auth (Phase 1)

- `POST /api/auth/telegram { initData }` → validates signature (30 min TTL), upsert user, create session (TTL from `SESSION_TTL_SECONDS`, cookie `spark_session` + Bearer token).
- `GET /api/me` → resolves the token hash, returns the authenticated user.
- Bot token is a server secret; never shipped to clients (TSA constraint from `docs/CONTRACT.md`).

## Arc-specific rules (from Phase 0)

- USDC is the native gas token; ERC-20 interface is 6 decimals, native view is 18 (`×1e12`).
- `maxFeePerGas >= max(20 gwei, 2×baseFee)` or the tx is silently dropped (~60s eviction).
- A movement emits two `Transfer` logs (`0x3600…` 6dp and system `0xffff…fffe` 18dp) — filter by emitter, never sum.
- Finality is deterministic and instant; act on 1 confirmation.
- Block timestamps are non-decreasing — order by block number + log index.

See `docs/spikes/` for evidence.
