# Security

## Boundaries

- **Telegram** — never trust `initDataUnsafe`. Validate raw `initData` HMAC-SHA256 server-side, enforce `auth_date` freshness (<= 300s), derive identity server-side.
- **Application** — never accept client-provided reward amounts as authoritative; recompute from campaign config. Enforce idempotency on every financial state change.
- **Blockchain** — never treat a submitted transaction as confirmed. Reconcile against receipts/events. Enforce `payReward` caps on-chain.

## Secrets

- All secrets live in `.env` (git-ignored). `.env.example` documents shape only.
- `OPERATOR_PRIVATE_KEY` is the only signing key; it is held by the worker and never leaves the process. Mainnet operator is a viem EOA (Phase 0 decision).

## Contract security requirements (PRD §30)

Replay protection, expiry, campaign/recipient/amount binding, budget protection, access control
(owner vs operator), and bounded emergency controls. No `withdraw` / `sweep` / `rescue` /
`SELFDESTRUCT`. Funds leave only via capped `payReward` or post-close creator refund.

## Non-negotiables (PRD §80)

No floating-point money. No mainnet before testnet validation. No financial state change without
idempotency. No Telegram-specific logic in the contract.
