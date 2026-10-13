# Phase 5: Arc Settlement Design

## Scope

Implements PRD §76 (Phase 5 — Arc Settlement): replace `MockSettlement` with real, operator-driven reward payouts against the deployed `CampaignEscrow` on Arc testnet, and add payout reconciliation. The flow becomes:

```
Reward Engine → Authorization (operator tx) → CampaignEscrow → Arc Testnet
                                                            → reconciliation
```

**In scope**
- Real `SettlementPort`: the worker submits `payReward` transactions as the operator EOA.
- Recipient resolution via `walletAssociations` (rewards are held when no wallet is associated).
- Numeric `onChainRewardId` per reward; persistence for `blockchain_transactions`, `campaign_events`, `chain_cursors`.
- Recurring settlement job (submit + poll receipts) and a `RewardPaid` reconciliation job.
- A testnet seeding script that creates + funds campaigns on Arc and records `campaigns.on_chain_campaign_id` (the escrow address itself is global via `ESCROW_ADDRESS`).
- Mocked unit tests plus an opt-in Arc-testnet integration test.

**Out of scope (later phases)**
- EIP-712 signed authorization (deferred; operator-only payout).
- Creator-facing funding UX (Phase 7 — Real Demo).
- Real per-user wallet onboarding (Phase 6 — Wallet).
- Campaign funding / refund / balance reconciliation (only reward-payout reconciliation is in scope).
- Mainnet.

**Non-goals** (PRD §82): no token, no fraud scoring, no extra chains, no reimplementing a wallet.

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Authorization | **Operator-only** against the already-deployed contract. No contract change, no redeploy. |
| Recipient source | Resolve from `wallet_associations` for `(campaignId, recipientUserId)`; if absent, the reward is **held** (stays `AUTHORIZED`). |
| Campaign funding | **Out of band**: a testnet seeding script creates + funds campaigns on Arc. Not wired into the backend in this phase. |
| `rewardId` | Add a numeric `rewards.on_chain_reward_id` (unique `bigint`, from sequence `reward_ref_seq`); pass it as the contract's `rewardId`. |
| Settlement cadence | Recurring pg-boss tick, **concurrency 1**, submit-then-poll. |
| Reconciliation | Reconcile **reward payouts** against the chain via `RewardPaid` logs. |
| Architecture | Receipt confirms each tx; a separate `getLogs` job reconciles/self-heals. |
| Code placement | `@spark/wallet` = viem EOA provider; `@spark/arc` = contract ABI + client; `worker` composes the real `SettlementPort`. |
| Testing | Mocked unit tests + an opt-in Arc-testnet integration test. |

**Deployed target:** `CampaignEscrow` at `0x9539efAFf246799827E6F5E6Cbc475122710Ef64` on Arc testnet (chain `5042002`), operator `0xfB4d09d7969d0446C45721E44409d9482eEcDCb1` (PRD `docs/CONTRACT.md`).

---

## Component Architecture

```
API verify ─► RewardEngine.authorizeForParticipation
                 │  rewards: AUTHORIZED, authorizationNonce, authorizationExpiresAt,
                 │           onChainRewardId, recipientUserId
                 ▼
worker: settlement tick (pg-boss, recurring, concurrency 1)
   1) SUBMIT:  resolve recipient (wallet_associations) ── absent ► hold (stay AUTHORIZED)
               payReward(chainCampaignId, onChainRewardId, nonce, recipient, amount, deadline)
               ► blockchain_transactions row (SUBMITTED) ► reward SUBMITTED
   2) POLL:    receipt success ► decode RewardPaid ► CONFIRMED + PAID + ledger
               reverted ► FAILED (reason-tagged)     tx missing ► RETRYING (bounded) ► FAILED
                 ▼
worker: reconciliation job (periodic)
   getLogs(RewardPaid) from cursor ► campaign_events
   any RewardPaid not reflected ► self-heal (mark PAID + ledger)
   DB PAID without on-chain event ► flag divergence
```

All movement is operator-authorized; the contract enforces campaign/recipient/amount binding, replay protection, expiry, and the three budget caps. There is **no** new fund-egress path.

---

## Data Model Changes

New Drizzle migration (`packages/db/drizzle/00xx_*.sql`, next sequential number — currently `0003`):

- `rewards.on_chain_reward_id` `bigint UNIQUE NOT NULL`, allocated from new sequence `reward_ref_seq` (starts `1`).
- `rewards.recipient_wallet` becomes **nullable**; the engine stops writing the `0x0` placeholder. Recipient is resolved at settle time.
- New table `chain_cursors`:
  - `id` pk, `chain_id` int, `contract_address` text, `last_block_number` bigint, `updated_at` timestamptz
  - `unique(chain_id, contract_address)`
- Extend table `blockchain_transactions` (schema already exists) with:
  - `attempts` int not null default 0, `last_checked_at` timestamptz null, `failure_reason` text null
  - existing columns retained: `campaign_id`, `reward_id` (nullable), `nonce`, `transaction_hash` (unique), `transaction_type`, `transaction_status`, `submitted_at`, `confirmed_at`, `failed_at`.
- `campaign_events` (schema already exists) is the replay-safe event store: `unique(chain_id, transaction_hash, log_index)`.

New repositories (in `@spark/db`):
- `rewards`: `nextRewardRef(db)` (sequence), `findRewardByOnChainId(db, ref)`, `listSubmittedRewards(db, limit)`.
- `blockchainTransactions`: `createTransaction`, `findByRewardId`, `listSubmitted`, `updateTransactionStatus`, `incrementAttempts`.
- `campaignEvents`: `insertEvent` (`onConflictDoNothing`), `existsEvent`.
- `walletAssociations`: `findByCampaignAndUser`.
- `chainCursors`: `getCursor(chainId, contractAddress)`, `setCursor(...)`.

---

## Reward Settlement State Machine

Existing `rewardStatus` enum: `ELIGIBLE, AUTHORIZED, SUBMITTED, CONFIRMED, PAID, SUBMISSION_FAILED, RETRYING, FAILED`.

```
AUTHORIZED ──submit ok──► SUBMITTED ──receipt success──► CONFIRMED ──► PAID (+ledger)
   │  │                      │
   │  └─send error──► SUBMISSION_FAILED
   │                         └─tx missing / retryable revert──► RETRYING ─►(re-submit) SUBMITTED
   │                                                                              └─cap reached──► FAILED
   └─deadline passed (authorizationExpiresAt ≤ now)──► FAILED (reason: expired)
```

Rules:
- **Nonce:** the DB's globally-unique `authorizationNonce` is passed as the contract `nonce`. Global uniqueness is stricter than the contract's per-campaign keying, so it can never collide.
- **Deadline:** the contract `deadline` = `authorizationExpiresAt` (unix seconds). `payReward` reverts `Expired` once `block.timestamp > deadline`.
- **Amount:** `amountMicroUsdc` (micro-USDC) is passed directly as `uint256`; the contract and DB share 6-decimal units.
- **Re-submission is safe:** re-sending an identical `payReward` reverts `NonceAlreadyUsed` / `RewardAlreadyProcessed`, which reconciliation treats as "already settled".
- **Held rewards:** a reward with no associated wallet for `(campaignId, recipientUserId)` is skipped and remains `AUTHORIZED` until a wallet exists.
- **Failure reasons:** `Expired` → `FAILED(expired)`; `PayoutTooLarge` / `AllowanceExceeded` → `FAILED(config)` (+ structured warning); `NonceAlreadyUsed` / `RewardAlreadyProcessed` → treat as settled (reconcile); transport/timeout/dropped → `RETRYING` up to a bounded attempt cap, then `FAILED(dropped)`.

---

## Worker Jobs

Registered and scheduled in `worker/src/index.ts` (replacing the current unregistered settlement path and the no-op reconciliation worker).

### `settlement` — recurring tick, concurrency 1

Function: `runSettlementCycle({ db, wallet, escrow, limit })`.

1. **Submit phase**
   - Select ≤ `SETTLE_BATCH_LIMIT` rewards in `AUTHORIZED`/`RETRYING`, unexpired, whose campaign has `on_chain_campaign_id` set.
   - For each: resolve recipient via `wallet_associations`; if none, skip (hold).
   - Build `payReward(chainCampaignId, onChainRewardId, nonce, recipient, amount, deadline)`, submit via the operator wallet, and on acceptance write `blockchain_transactions` (`SUBMITTED`) and set reward `SUBMITTED`.
   - Per-reward try/catch so one failure never blocks the batch.
2. **Poll phase**
   - Select rewards in `SUBMITTED` and read their `transaction_hash`.
   - `getTransactionReceipt`:
     - success → decode `RewardPaid` → `CONFIRMED` then `PAID` + append ledger entry (`USER_REWARD` / `REFERRAL_REWARD`, `idempotencyKey = "reward:<rewardId>"`).
     - reverted → `FAILED` (reason-tagged; config reverts flagged).
     - not found → increment `attempts`; if under cap (default `5`) → `RETRYING`; else `FAILED(dropped)`.

Cadence: every `SETTLE_INTERVAL_SECONDS`. Concurrency 1 keeps operator nonce management trivial.

### `reconciliation` — periodic, read-only

Function: `runReconciliation({ db, escrow })`.

- `getLogs(RewardPaid)` from `chain_cursors.last_block_number` (with a small overlap buffer, default 5 blocks) to latest.
- Insert each event into `campaign_events` (`onConflictDoNothing`); advance the cursor.
- For any `RewardPaid` not reflected in `rewards`/ledger → **self-heal**: mark the matching reward `PAID` and append the ledger entry idempotently.
- For any DB reward `PAID` with no corresponding on-chain event → emit a structured divergence warning (no automatic mutation).
- Uses the dual-emitter rule (`docs/spikes/S0-5-reconcile.md`) for any raw-transfer inspection; filter by emitter, never sum `0x3600…` (6dp) and `0xffff…fffe` (18dp).

---

## Packages & Clients

- `@spark/wallet`: `createViemWalletProvider({ rpcUrl, privateKey })` → `WalletProvider` (`address`, `getNonce`, `sendTransaction`, `getReceipt`) backed by viem `publicClient` + `walletClient`. Enforces Arc gas `maxFeePerGas ≥ max(20 gwei, 2×baseFee)` via `@spark/arc.requiredMaxFeePerGas`.
- `@spark/arc`: `campaignEscrowAbi` (minimal ABI: `payReward` + the `RewardPaid` event), `getRewardPaidLogs(publicClient, address, fromBlock, toBlock)`, `decodeRewardPaid(log)`. A drift test asserts the ABI's relevant entries match the forge artifact when it exists.
- `@spark/reward`: `PayoutRequest` gains `deadline: bigint`. Keep `createMockSettlement` for unit tests. The port interface (`submitPayout`, `getPayoutStatus`) is unchanged.
- `worker`: `createOnchainSettlement({ wallet, escrow })` implements `SettlementPort` — maps micro-USDC `bigint` ↔ `uint256`, encodes `payReward`, returns the tx hash, and derives payout status from the receipt. The settlement/reconciliation jobs compose it with `@spark/db`.

---

## Env & Config

New `worker/src/env.ts` (zod, mirroring `apps/api/src/env.ts`):

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | — | Postgres |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` | |
| `ARC_CHAIN_ID` | `5042002` | |
| `ARC_USDC_ADDRESS` | `0x3600…0000` | |
| `ESCROW_ADDRESS` | — | Deployed escrow (`0x9539…`) |
| `OPERATOR_PRIVATE_KEY` | — | Worker-only signing key |
| `SETTLE_BATCH_LIMIT` | `25` | |
| `SETTLE_INTERVAL_SECONDS` | — | tick cadence |
| `RECONCILE_INTERVAL_SECONDS` | — | reconciliation cadence |

Update `.env.example` and `.env` with `ESCROW_ADDRESS`. The operator key is the worker's only secret (PRD `docs/SECURITY.md`); it is never logged or committed.

---

## Contract Interface & ABI

No contract change. The worker calls the deployed interface:

```solidity
function payReward(
    uint256 campaignId,
    uint256 rewardId,
    uint256 nonce,
    address recipient,
    uint256 amount,
    uint256 deadline
) external; // onlyOperator
event RewardPaid(uint256 indexed campaignId, uint256 indexed rewardId, address indexed to, uint256 amount, uint256 nonce);
```

Read-only helpers used: none required for payouts. The ABI lives in `@spark/arc` as a TypeScript constant (minimal — `payReward` + `RewardPaid`).

---

## Testing

**Mocked unit tests** (no network/Docker):
- `@spark/wallet`: provider getNonce/send/receipt with a mocked transport; gas-floor calculation.
- `@spark/arc`: `decodeRewardPaid`; ABI-vs-artifact drift check.
- worker settlement: fake `WalletProvider` + fake escrow client → assert submit→`SUBMITTED`, receipt success→`PAID`+ledger, revert→`FAILED`, missing→`RETRYING`→`FAILED` at cap, hold when no wallet, per-reward failure isolation.
- worker reconciliation: fixture `RewardPaid` logs → `campaign_events` insert, cursor advance, self-heal, divergence flag, idempotent replays.
- `rewardId`/`deadline`/`nonce` mapping.

**Opt-in Arc-testnet integration test** (`RUN_ARC_INTEGRATION=1`, funded operator key, direct RPC — no Docker):
- Seed a campaign on Arc, associate a wallet, authorize a reward, run one settlement cycle, and assert: on-chain `RewardPaid` emitted, reward `PAID`, ledger entry present, and a second reconciliation run is idempotent.
- Skipped by default so normal CI stays offline.

---

## Security & Operations

- **Operator key:** worker-only, loaded from env, never logged, never committed (`.env` is git-ignored). The currently-present testnet key should be rotated before any reuse.
- **No extra egress:** the contract is unchanged; funds move only via capped `payReward` or post-close refund.
- **Three-layer idempotency:** contract replay maps (`processedReward`, `usedNonce`), `blockchain_transactions.transaction_hash` unique, ledger `idempotency_key` unique.
- **Silent-drop resilience (Arc):** poll timeout → `RETRYING` (bounded) → `FAILED`; gas always above the Arc floor.
- **Read-only reconciliation:** `getLogs` only; no signing key required.
- **Observability:** structured warnings on `FAILED(config)` and DB↔chain divergence.
- **Failure isolation:** per-reward try/catch; a single bad reward never blocks the batch.

---

## Definition of Done

- An authorized reward for a user with an associated wallet is paid on-chain on Arc testnet: `RewardPaid` observed, reward `PAID`, ledger entry written, and the ledger/campaign figures reconcile.
- Restarting the worker mid-flight neither double-pays nor loses rewards (idempotency + reconciliation self-heal).
- Unit tests pass offline; the opt-in Arc-testnet integration test passes when enabled.

---

## Future Extension Points

- **EIP-712 authorization** (deferred): add `bytes authorization` to `payReward`; the operator (or a separate signer) signs `(campaignId, rewardId, recipient, amount, nonce, deadline)`. Contract change + redeploy required.
- **Campaign funding/refund reconciliation:** extend reconciliation to campaign balances using the dual-emitter transfer rule.
- **Creator funding UX** (Phase 7) and **wallet onboarding** (Phase 6) plug into the same `wallet_associations` and campaign seeding seams.
