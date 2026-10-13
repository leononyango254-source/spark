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

## Telegram (Phase 2)

- `apps/bot` long-polls `getUpdates` and answers `/start`, opening the Mini App (deep links with `startapp=c_<publicId>_<referralCode>`).
- `POST /api/campaigns/:publicId/verify` checks the user's membership in the campaign channel via `getChatMember` (bot must be an admin of the target chat, PRD §15), cached in-memory for `MEMBERSHIP_CACHE_TTL_MS`.
- `apps/telegram-mini-app` is a Vite static client; it posts raw `initData` to `/api/auth/telegram` and never trusts `initDataUnsafe`.

## Campaign Engine (Phase 3)

### Three engine packages

| Package | Responsibility |
|---------|----------------|
| `@spark/campaign` | Campaign lifecycle: create (DRAFT), fund (FUNDING → FUNDED), activate (ACTIVE), pause/resume, close. Enforces state transitions and budget minimums. |
| `@spark/referral` | Referral attribution and qualification. `getOrCreateReferralCode` issues stable 8-char codes; `attribute` (called on referred user login) creates a `referrals` row at `ATTRIBUTED`; `qualify` (called on successful verification) advances to `QUALIFIED`. |
| `@spark/reward` | Reward authorization and settlement. `authorizeForParticipation` creates `USER_COMPLETION` reward (amount = `campaign.rewardMicroUsdc`) and, if a `QUALIFIED` referral exists, a `REFERRAL` reward (amount = `campaign.referralRewardMicroUsdc`). Both rewards get unique `authorizationNonce` and `authorizationExpiresAt` (7 days). Budget is atomically reserved via conditional `UPDATE campaigns SET balanceMicroUsdc = balanceMicroUsdc - total WHERE balanceMicroUsdc >= total`. |

### Referral attribution lifecycle

1. Creator calls `GET /api/campaigns/:publicId/referral-link` → receives stable `referralCode` (stored in `referralCodes`).
2. Referred user logs in via `POST /api/auth/telegram { initData, campaignPublicId, referralCode }` → API resolves referrer via `referralCodes`, calls `referralEngine.attribute` → `referrals` row created with `status = ATTRIBUTED`.
3. Referred user verifies membership via `POST /api/campaigns/:publicId/verify` → on success, `referralEngine.qualify` advances referral to `QUALIFIED`.

### Reward state machine through `PAID`

| Reward type | Trigger | States |
|-------------|---------|--------|
| `USER_COMPLETION` | `authorizeForParticipation` (participation `VERIFIED`) | `ELIGIBLE → AUTHORIZED → SUBMITTED → CONFIRMED → PAID` |
| `REFERRAL` | Same, only if referral `QUALIFIED` | `ELIGIBLE → AUTHORIZED → SUBMITTED → CONFIRMED → PAID` |

When a `REFERRAL` reward reaches `AUTHORIZED`, the referral row moves `QUALIFIED → REWARD_PENDING`. When it reaches `PAID`, the referral row moves `REWARD_PENDING → PAID`.

### Atomic budget reservation

`authorizeForParticipation` reserves the total payout (`rewardMicroUsdc + referralRewardMicroUsdc` if applicable) in a single conditional UPDATE:

```sql
UPDATE campaigns
SET balanceMicroUsdc = balanceMicroUsdc - $total
WHERE id = $campaignId AND balanceMicroUsdc >= $total
```

If the reservation fails (insufficient balance), no rewards are created.

### Mock settlement boundary (Phase 4/5 will replace)

Phase 3 uses `MockSettlement` (in `@spark/reward`):
- `submitPayout` returns a deterministic fake `txHash` (SHA-256 of campaignId:rewardId:nonce).
- `getPayoutStatus` immediately returns `confirmed`.

The settlement worker (`worker/src/settlement`) drives each `AUTHORIZED` reward through `SUBMITTED → CONFIRMED → PAID`, appends an immutable `ledger_entries` row (`USER_REWARD` or `REFERRAL_REWARD`, direction −1, idempotency key `reward:<rewardId>`), and reduces campaign balance.

Phase 4/5 will replace `MockSettlement` with a real `WalletProvider` implementation that submits `payReward` to the `CampaignEscrow` contract on Arc, waits for 1 confirmation, and reconciles on-chain events.
