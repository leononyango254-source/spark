# Spark — Telegram USDC Campaigns on Arc

Campaign creators deposit USDC into an Arc campaign escrow; Telegram users complete verified
actions; the platform automatically settles predefined rewards to eligible participants and
referrers.

- **Telegram** = identity + distribution + verification
- **Backend** = campaign + eligibility + reward logic
- **CampaignEscrow** = financial enforcement
- **Arc** = settlement
- **USDC** = campaign budget + reward asset

Full requirements: [`docs/PRD.md`](docs/PRD.md). Phase 0 findings: [`docs/spikes/GO-NO-GO.md`](docs/spikes/GO-NO-GO.md).

## Repository layout

```
apps/
  api/                 Fastify HTTP API
  telegram-mini-app/   Telegram Mini App (placeholder)
  web/                 Public web (placeholder)
packages/
  domain/              Money/ids/state primitives
  telegram/            initData validation + membership rules
  wallet/              WalletProvider port
  arc/                 Arc chain constants + config
  rewards/             Reward + participation state machines
  ledger/              Append-only ledger types
  db/                  Drizzle schema + migrations
worker/                Background jobs (settlement, reconciliation)
contracts/             Foundry project (CampaignEscrow.sol)
docs/                  PRD, architecture, security, contract notes
spikes/                Phase 0 spike evidence (throwaway)
```

## Prerequisites

- Node >= 22 (see `.nvmrc`)
- pnpm 12 — this repo uses `pnpm@12.8.1` (via `packageManager`)
- Docker (Postgres 17)
- Foundry (`forge`) for contracts

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm db:up            # start Postgres 17
pnpm typecheck        # strict TS across workspaces
pnpm lint             # Biome
pnpm test             # Vitest across workspaces
```

Contracts:

```bash
cd contracts && forge test
```

## Conventions & guardrails (PRD §80)

- Money is integer micro-USDC (`bigint`) — **never** floating point.
- Secrets only in `.env` (git-ignored); `.env.example` documents shape.
- Never trust Telegram `initDataUnsafe` — validate `initData` server-side.
- Never treat a submitted transaction as confirmed.
- Never implement mainnet transactions before testnet validation.
- No new MVP features without explicit approval.

## Status

Phase 0 (integration spike) complete → **GO**. Currently at **Phase 1 — Foundation**.
