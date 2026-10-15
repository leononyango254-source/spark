# Spark — Performance Marketing & On-Chain Rewards

Spark is a performance marketing platform for brands, crypto projects, meme communities, creators, influencers and micro-influencers. It is being built to help campaign owners acquire users and drive measurable engagement through task-based campaigns, with rewards tied to verified actions rather than clicks alone.

The product vision is simple: **launch a campaign, activate creator and community distribution, verify the outcome, and reward eligible participants on-chain.**

Campaigns are designed to support Galxe-style quests and community growth workflows, with USDC rewards settled on Arc. Telegram is the initial distribution, identity and task-verification channel, not the product's defining limit.

## How it works

1. **Launch a campaign** — define the goal, required action, reward and campaign budget.
2. **Activate distribution** — share the campaign through Telegram, influencers, micro-influencers and communities.
3. **Verify the result** — validate that each participant completed the required task.
4. **Reward eligible actions** — settle approved USDC rewards on Arc.
5. **Measure performance** — track verified completions, campaign spend and rewards paid as the product's analytics mature.

## Product direction

Spark aims to make outcome-based campaigns accessible to both crypto-native and mainstream communities:

- **Brands and marketers** can run campaigns around user acquisition, engagement and community growth.
- **Influencers and micro-influencers** can distribute campaigns and mobilize their audiences.
- **Crypto projects and meme communities** can incentivize participation with transparent reward rules.
- **Participants** can complete clearly defined tasks and earn rewards for verified outcomes.

The long-term direction is a flexible campaign and verification engine that can support multiple task types and distribution channels. Creator discovery, a creator marketplace and advanced analytics are possible future extensions, not prerequisites for the initial product.

## Current MVP scope

The initial implementation is intentionally narrower than the long-term vision. It focuses on:

- Telegram-based identity and campaign entry.
- Telegram channel-membership verification.
- Campaign and participant eligibility logic.
- Completion rewards and optional one-level referral rewards.
- USDC-denominated campaign accounting and Arc settlement architecture.

**Project status matters:** not every item above is live or production-ready. The repository is currently in **Phase 1 — Foundation** following completion of the Phase 0 integration spikes. Some end-to-end campaign and payout flows are still being implemented. Do not treat this repository as a live campaign service or send real funds based on the roadmap alone.

## Architecture at a glance

- **Telegram** — initial identity, distribution and task verification.
- **Application backend** — campaign rules, eligibility, reward authorization and reconciliation.
- **PostgreSQL** — campaign state, participation, reward state and accounting records.
- **CampaignEscrow** — intended on-chain enforcement for campaign budgets and payouts.
- **Arc + USDC** — intended settlement network and reward asset.

Full requirements: [docs/PRD.md](docs/PRD.md).  
Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).  
Phase 0 integration findings: [docs/spikes/GO-NO-GO.md](docs/spikes/GO-NO-GO.md).

## Repository layout

```
apps/
  api/                 Fastify HTTP API
  telegram-mini-app/   Telegram Mini App
  web/                 Public web
packages/
  domain/              Money, IDs and state primitives
  telegram/            Telegram initData validation and membership rules
  wallet/              WalletProvider interface
  arc/                 Arc chain constants and configuration
  rewards/             Reward and participation state machines
  ledger/              Append-only ledger types
  db/                  Drizzle schema and migrations
worker/                Background jobs (settlement, reconciliation)
contracts/             Foundry project (CampaignEscrow.sol)
docs/                  PRD, architecture, security and contract notes
spikes/                Phase 0 integration evidence
```

## Development setup

### Prerequisites

- Node.js >= 22 (see `.nvmrc`)
- pnpm 12 — this repository uses `pnpm@12.8.1`
- Docker for PostgreSQL 17
- Foundry (`forge`) for smart-contract tests

### Quickstart

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm typecheck
pnpm lint
pnpm test
```

Run contract tests:

```bash
cd contracts && forge test
```

## Engineering guardrails

- Represent money as integer micro-USDC (`bigint`), never floating point.
- Keep secrets in local environment files or deployment secret stores; never commit them.
- Validate Telegram `initData` on the server. Do not trust `initDataUnsafe` as authentication.
- A submitted transaction is not a confirmed transaction.
- Validate chain interactions on Arc testnet before any mainnet activity.
- Keep campaign budgets, reward transitions and payout retries safe against duplicate processing.
- Do not expand the MVP scope without an explicit product decision.

## Current status

**Phase 0: complete. Phase 1: Foundation.** The integration spikes established a viable technical path; they do not mean the full application or production payout flow is complete.

This is an actively developed project. Product direction and implementation status are stated separately so the long-term vision is clear without implying that planned features are already available.
