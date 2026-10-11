# TASK-002 — Monorepo Scaffold + Engineering Guardrails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax.

**Goal:** Create the pnpm-workspace monorepo, toolchain, and CI guardrails from PRD §70/§80 so later phases have a green, typed, tested foundation. No business logic, no money movement.

**Architecture:** pnpm workspaces. Apps consume `@spark/*` packages. Strict TypeScript via a shared `tsconfig.base.json`. Biome for lint/format, Vitest for tests. Postgres 17 via Docker Compose. Foundry under `contracts/`.

**Tech Stack:** pnpm 12, TypeScript 5 (NodeNext, strict), Biome, Vitest, Fastify 5, Zod 4, viem, Drizzle ORM + drizzle-kit, pg-boss, PostgreSQL 17, Foundry (Solidity 0.8.26, `cancun`).

---

## File structure (PRD §70, adapted to a pnpm workspace)

```
apps/web, apps/telegram-mini-app, apps/api
packages/{domain,telegram,wallet,arc,rewards,ledger,db}
worker/{src/settlement,src/reconciliation}
contracts/{src,script,test}
docs/{PRD.md,ARCHITECTURE.md,SECURITY.md,CONTRACT.md}
```

## Task 1: Root workspace + tooling
- [x] `pnpm-workspace.yaml`, root `package.json` (scripts: lint, format, typecheck, test, build), `tsconfig.base.json`, `biome.json`, `.editorconfig`, `.nvmrc`, extend `.gitignore`, `docker-compose.yml`, `.env.example`, `README.md`.

## Task 2: docs
- [x] Move `Spark prd.md` → `docs/PRD.md` (verbatim). Add `ARCHITECTURE.md`, `SECURITY.md`, `CONTRACT.md` stubs reflecting Phase 0 decisions.

## Task 3: packages (typed placeholders)
- [x] `@spark/domain`: `MicroUsdc` brand + money helpers (integer only), `MoneyError`. Tests.
- [x] `@spark/arc`: chain ids, RPCs, USDC address, 20-Gwei floor, emitter constants, decimals helper. Tests.
- [x] `@spark/telegram`: `initData` validator (ported from S0-6) + membership rules. Tests.
- [x] `@spark/wallet`: `WalletProvider` interface only.
- [x] `@spark/rewards`: reward/participation state unions + transitions. Tests.
- [x] `@spark/ledger`: ledger entry types.
- [x] `@spark/db`: Drizzle config + empty schema barrel (no tables yet).

## Task 4: apps
- [x] `@spark/api`: Fastify 5 server, `/health`, Zod env parsing. Tests.
- [x] `@spark/worker`: pg-boss skeleton entrypoint (no jobs yet).
- [x] `apps/web`, `apps/telegram-mini-app`: placeholder package.

## Task 5: contracts
- [x] `contracts/foundry.toml` (`evm_version="cancun"`, solc 0.8.26); seed `src/CampaignEscrow.sol` from the proven S0-2 skeleton; port the 3 spike tests.

## Task 6: verify
- [x] `pnpm install`; `pnpm lint`, `pnpm typecheck`, `pnpm test` all green; `forge test` green.

## Guardrails (PRD §80)
- No secrets in code (`.env.example` only). No floating-point money (`MicroUsdc` = `bigint`). No `initDataUnsafe`. No submitted-as-confirmed. No mainnet before testnet.
