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

## Arc-specific rules (from Phase 0)

- USDC is the native gas token; ERC-20 interface is 6 decimals, native view is 18 (`×1e12`).
- `maxFeePerGas >= max(20 gwei, 2×baseFee)` or the tx is silently dropped (~60s eviction).
- A movement emits two `Transfer` logs (`0x3600…` 6dp and system `0xffff…fffe` 18dp) — filter by emitter, never sum.
- Finality is deterministic and instant; act on 1 confirmation.
- Block timestamps are non-decreasing — order by block number + log index.

See `docs/spikes/` for evidence.
