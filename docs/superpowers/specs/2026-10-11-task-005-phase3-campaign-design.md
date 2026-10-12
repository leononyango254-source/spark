# Phase 3: Campaign + Referral + Reward Engines Design

## Scope

Implements PRD §74 (Phase 3 — Campaign Engine): campaign lifecycle, task, participation, referral, eligibility, reward records. Settlement is **mocked** — the full reward state machine advances through `PAID` against a `SettlementPort` mock, with **no real Arc chain calls and no contract changes**. Real contract work is PRD §75 (Phase 4); real Arc settlement is PRD §76 (Phase 5).

Architecture: separate engine packages with shared pure domain logic, matching the `@spark/telegram` pattern.

## Package Structure

```
@spark/domain     # money (exists), publicId (exists), referralCode (exists) — no change beyond exports
@spark/rewards    # reward + participation state machines (EXISTS — reuse canTransitionReward)
@spark/ledger     # ledger entry types + directions (EXISTS — reuse)
@spark/campaign   # CampaignEngine: create, configure, fund, activate, pause/resume/close, stats
@spark/referral   # ReferralEngine: link, attribute (first-wins), freeze, qualify; referral state machine
@spark/reward     # RewardEngine + SettlementPort + MockSettlement
@spark/db         # NEW repositories + one migration (see below)
```

## Existing Infrastructure (do NOT recreate)

- `packages/db/src/schema/{campaigns,tasks,referrals,participations,rewards,ledger,campaignEvents,fundingHandoffs,transactions,wallets}.ts` and `enums.ts` all exist.
- `packages/db/src/repositories/{campaigns,tasks,users,sessions}.ts` exist.
- `packages/rewards/src/index.ts` has `REWARD_STATES`, `PARTICIPATION_STATES`, `canTransitionReward`, `assertRewardTransition`.
- `packages/ledger/src/index.ts` has `LEDGER_ENTRY_TYPES`, `LEDGER_DIRECTION`.
- `packages/wallet/src/index.ts` has `WalletProvider` port (Phase 6).
- `contracts/src/CampaignEscrow.sol` is a Phase-0 spike skeleton — **not touched in Phase 3**.

## Schema Migration Required (packages/db)

1. **campaigns**: add `maxParticipants integer NULL`, `participantCount integer NOT NULL DEFAULT 0`. Add check `participantCount >= 0` and (`maxParticipants IS NULL OR participantCount <= maxParticipants`).
2. **referral_status** enum: replace `('PENDING','REWARDED','REJECTED')` with `('ATTRIBUTED','QUALIFIED','REWARD_PENDING','PAID','REJECTED')`.
3. **referrals**: add `qualified_at timestamptz NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`.

Migration generated with `pnpm --filter @spark/db db:generate` (drizzle-kit) so it stays consistent with `schema/`.

## State Machines

### Campaign (campaignStatus enum: DRAFT/FUNDING/FUNDED/ACTIVE/PAUSED/CLOSED/FUNDING_FAILED)
```
DRAFT → FUNDING (fund initiated)
FUNDING → FUNDED (funded balance >= required minimum)   | FUNDING_FAILED
FUNDED → ACTIVE (activate)
ACTIVE → PAUSED (pause) | CLOSED (close) | FUNDING_FAILED (insufficient balance)
PAUSED → ACTIVE (resume) | CLOSED (close)
```
`requiredMinimum = maxParticipants !== null ? rewardMicroUsdc * maxParticipants + referralRewardMicroUsdc * maxParticipants : budgetMicroUsdc`.

### Referral (referral_status enum)
```
ATTRIBUTED → QUALIFIED (referred user verified)
QUALIFIED → REWARD_PENDING (referral reward authorized)
REWARD_PENDING → PAID (referral reward settled)
any → REJECTED (self-referral detected / ineligible)
```

### Reward (reuse @spark/rewards REWARD_TRANSITIONS)
```
ELIGIBLE → AUTHORIZED → SUBMITTED → CONFIRMED → PAID
                              ↘ SUBMISSION_FAILED → RETRYING → SUBMITTED
                        SUBMITTED → FAILED
```

### Participation (participationStatus enum: STARTED/PENDING_VERIFICATION/VERIFIED/WALLET_REQUIRED/REWARD_PENDING/REWARDED/REJECTED)
```
STARTED → PENDING_VERIFICATION (task started)
PENDING_VERIFICATION → VERIFIED (verify ok) | REJECTED
VERIFIED → WALLET_REQUIRED (no wallet) | REWARD_PENDING (rewards authorized)
REWARD_PENDING → REWARDED (all rewards PAID)
```

## @spark/campaign — CampaignEngine

```ts
export interface CampaignEngine {
  createCampaign(input: CreateCampaignInput): Promise<CampaignRow>;
  updateConfig(campaignId: string, config: CampaignConfigInput): Promise<CampaignRow>;
  fundCampaign(campaignId: string, amountMicroUsdc: bigint): Promise<CampaignRow>; // sets FUNDING→FUNDED (mock)
  activateCampaign(campaignId: string): Promise<CampaignRow>;
  pauseCampaign(campaignId: string): Promise<CampaignRow>;
  resumeCampaign(campaignId: string): Promise<CampaignRow>;
  closeCampaign(campaignId: string): Promise<CampaignRow>;
  getCampaignStats(campaignId: string): Promise<CampaignStats>;
}
```
- `createCampaign`: DRAFT, generates `publicId` via `generatePublicId`, creator must exist, validates reward/budget/chat config.
- `updateConfig`: only while DRAFT; sets rewards, budget, maxParticipants, target chat.
- `fundCampaign`: mocked — sets `status FUNDED`, `balanceMicroUsdc = amount` (assert amount >= required minimum). Real escrow deposit is Phase 5.
- `activateCampaign`: requires status FUNDED and balance >= required minimum → ACTIVE, sets `activatedAt`.
- `closeCampaign`: ACTIVE/PAUSED → CLOSED, sets `closedAt`.

## @spark/referral — ReferralEngine

```ts
export interface ReferralEngine {
  linkForReferrer(input: {
    campaignId: string;
    publicId: string;
    referrerUserId: string;
    botUsername: string;
    appName: string;
  }): Promise<ReferralLink>; // stable `referralCode` + c_<publicId>_<code> startapp + deep link
  attribute(input: {
    campaignPublicId: string;
    referralCode: string;
    referredUserId: string;
  }): Promise<ReferralRow | null>; // first-wins, idempotent, no self-ref
  qualify(campaignId: string, referredUserId: string): Promise<ReferralRow | null>;
}
```
Rules (PRD §19–§20):
- Attribution happens at `/api/auth/telegram` when the request body includes a `referralCode`, resolved server-side to (campaign, referrer). Client-submitted referrer id is never trusted.
- Unique `(campaignId, referredUserId)`; first valid attribution wins (no overwrite); self-referral rejected; repeat auth is idempotent.
- Referral rows are `ATTRIBUTED` only — no payable reward until the referred user is verified.
- Freeze: participation creation refuses to attribute a referrer afterwards (a referred user with a Participation row can never be attributed).
- Qualify: after successful verification, `ATTRIBUTED → QUALIFIED`.
- The `QUALIFIED → REWARD_PENDING → PAID` milestones of the referral row are driven by the **RewardEngine** (authorization of the `REFERRAL` reward, then its settlement), not the ReferralEngine.

## @spark/reward — RewardEngine + SettlementPort

```ts
export interface SettlementPort {
  submitPayout(req: PayoutRequest): Promise<{ txHash: string }>;
  getPayoutStatus(txHash: string): Promise<"pending" | "confirmed" | "failed">;
}

export interface RewardEngine {
  authorizeForParticipation(campaignId: string, participationId: string): Promise<RewardRow[]>;
  listSettleable(limit: number): Promise<RewardRow[]>;
  markSubmitted(rewardId: string, txHash: string): Promise<void>;
  markConfirmed(rewardId: string): Promise<void>;
  markPaid(rewardId: string): Promise<void>;
  markSubmissionFailed(rewardId: string, reason: string): Promise<void>;
}
```
- `authorizeForParticipation`: only if campaign ACTIVE, participation VERIFIED; creates USER_COMPLETION reward (amount = campaign.rewardMicroUsdc) and, if a QUALIFIED referral exists, a REFERRAL reward (amount = campaign.referralRewardMicroUsdc). Both get unique `authorizationNonce` and `authorizationExpiresAt`. `ELIGIBLE → AUTHORIZED` in one step. Authorizing a REFERRAL reward moves the referral row `QUALIFIED → REWARD_PENDING`.
- **Atomic budget reservation**: reserving budget is a single conditional UPDATE on campaigns (`balanceMicroUsdc -= amount` where balance >= amount), done in a transaction; failure aborts that reward with no partial rows.
- Unique `(campaignId, participationId, rewardType)` guarantees one reward per type (idempotent re-verify).
- Settling a REFERRAL reward (markPaid) moves the referral row `REWARD_PENDING → PAID` alongside the reward states.
- `MockSettlement`: `submitPayout` returns a fake hash immediately and `getPayoutStatus` returns `confirmed`; used by the settlement worker in Phase 3.

## Settlement Worker (worker/src/settlement)

Phase 3 wires the worker against `MockSettlement`:
1. `listSettleable` → for each AUTHORIZED (not expired) reward: `markSubmitted(nonce-derived txHash)`.
2. `getPayoutStatus` → on `confirmed`: `markConfirmed` then append ledger entry (`USER_REWARD`/`REFERRAL_REWARD`, direction −1) idempotent via `idempotencyKey = reward:<rewardId>`, then `markPaid`. On `failed`: `markSubmissionFailed`.
3. Never equate SUBMITTED with PAID. Crash-safe: authorization is persisted before submission; already-submitted rewards are recognised by txHash.

## API Endpoints (apps/api)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/campaigns` | Create campaign (DRAFT) |
| GET | `/api/campaigns/:publicId` | Fetch campaign + status |
| PATCH | `/api/campaigns/:publicId` | Update config (DRAFT only) |
| POST | `/api/campaigns/:publicId/fund` | Mock funding → FUNDED |
| POST | `/api/campaigns/:publicId/activate` | Activate → ACTIVE |
| POST | `/api/campaigns/:publicId/pause` | Pause |
| POST | `/api/campaigns/:publicId/resume` | Resume |
| POST | `/api/campaigns/:publicId/close` | Close |
| GET | `/api/campaigns/:publicId/stats` | Stats |
| POST | `/api/campaigns/:publicId/verify` | Verify → record participation → authorize rewards (extend existing) |
| POST | `/api/auth/telegram` | Extend body `{ initData, referralCode? }` → attribute referral |

## Mini App + Bot

- Mini App: on launch, parse `startapp` (`parseStartParam`) and send `referralCode` alongside `initData` in `authenticate`; show campaign status, Verify button, and reward state.
- Bot: existing `/start` deep-link handling stays; add a referral-link share helper using `ReferralEngine.buildLink`.

## Verification

- Unit + integration tests per package (Vitest, testcontainers for DB/api).
- End-to-end Phase 3 demo (integration test): create campaign → fund → activate → user auth with referral → verify membership (stub) → participation VERIFIED → rewards AUTHORIZED (user + referral) → mock settlement worker → rewards PAID, referral PAID, ledger entries appended.
- Keep forge suite green (3/3); no contract changes.
