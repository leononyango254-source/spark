# Phase 3: Campaign + Referral + Reward Engines Design

## Overview

Phase 3 implements the core business logic engines per PRD §76-§109 (Campaigns, User participation, Referral) and §21-§25 (Reward model, state machine, idempotency, ledger).

Architecture: separate engine packages with shared types in `@spark/domain`, matching the `@spark/telegram` pattern.

---

## Package Structure

```
@spark/domain          # Campaign, Referral, Participation, Reward types + state machines
@spark/campaign        # CampaignEngine: create, configure, fund, activate, pause/resume/close, stats
@spark/referral        # ReferralEngine: generate deep link, attribute at auth, freeze, qualify
@spark/reward          # RewardEngine: eligibility → reserve budget → authorize (nonce) → worker submits payout
@spark/db              # Repositories + migrations for campaigns, referrals, participations, rewards, ledger
```

---

## @spark/domain — Shared Types

### Campaign
```ts
export enum CampaignStatus {
  DRAFT = "DRAFT",
  FUNDING = "FUNDING",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  EXHAUSTED = "EXHAUSTED",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED",
}

export interface CampaignRow {
  id: string;
  publicId: string;
  creatorId: string;
  name: string;
  description: string | null;
  targetChatId: bigint | null;
  targetChatUsername: string | null;
  targetChatTitle: string | null;
  userRewardMicroUsdc: bigint;
  referralRewardMicroUsdc: bigint;
  budgetMicroUsdc: bigint;
  fundedMicroUsdc: bigint;
  paidMicroUsdc: bigint;
  status: CampaignStatus;
  maxParticipants: number | null;
  participantCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Task (MVP: TELEGRAM_CHANNEL_MEMBERSHIP)
```ts
export enum TaskType {
  TELEGRAM_CHANNEL_MEMBERSHIP = "TELEGRAM_CHANNEL_MEMBERSHIP",
}

export interface TaskRow {
  id: string;
  campaignId: string;
  type: TaskType;
  config: Record<string, unknown>; // { chat_id: string, chat_username?: string }
  rewardMicroUsdc: bigint;
  createdAt: Date;
}
```

### Referral
```ts
export enum ReferralStatus {
  ATTRIBUTED = "ATTRIBUTED",      // created at auth, provisional
  QUALIFIED = "QUALIFIED",        // verified, ready for reward
  REWARD_PENDING = "REWARD_PENDING",
  PAID = "PAID",
  REJECTED = "REJECTED",
}

export interface ReferralRow {
  id: string;
  campaignId: string;
  referrerUserId: string;
  referredUserId: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: Date;
  qualifiedAt: Date | null;
}
```

### Participation
```ts
export enum ParticipationStatus {
  STARTED = "STARTED",
  PENDING_VERIFICATION = "PENDING_VERIFICATION",
  VERIFIED = "VERIFIED",
  REWARD_PENDING = "REWARD_PENDING",
  REWARDED = "REWARDED",
  REJECTED = "REJECTED",
}

export interface ParticipationRow {
  id: string;
  campaignId: string;
  userId: string;
  taskId: string;
  referralCodeUsed: string | null;
  referrerUserId: string | null;
  status: ParticipationStatus;
  verifiedAt: Date | null;
  rewardId: string | null;
  createdAt: Date;
}
```

### Reward
```ts
export enum RewardType {
  USER_COMPLETION = "USER_COMPLETION",
  REFERRAL = "REFERRAL",
}

export enum RewardStatus {
  ELIGIBLE = "ELIGIBLE",
  AUTHORIZED = "AUTHORIZED",
  SUBMITTED = "SUBMITTED",
  CONFIRMED = "CONFIRMED",
  PAID = "PAID",
  SUBMISSION_FAILED = "SUBMISSION_FAILED",
  RETRYING = "RETRYING",
  FAILED = "FAILED",
}

export interface RewardRow {
  id: string;
  campaignId: string;
  participationId: string;
  rewardType: RewardType;
  recipientUserId: string;
  recipientWallet: string;
  amountMicroUsdc: bigint;
  authorizationNonce: bigint;
  authorizationExpiresAt: Date;
  status: RewardStatus;
  chainId: number;
  transactionHash: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  paidAt: Date | null;
}
```

### Ledger
```ts
export enum LedgerEntryType {
  CAMPAIGN_FUNDING = "CAMPAIGN_FUNDING",
  USER_REWARD = "USER_REWARD",
  REFERRAL_REWARD = "REFERRAL_REWARD",
  CAMPAIGN_REFUND = "CAMPAIGN_REFUND",
}

export interface LedgerEntryRow {
  id: string;
  campaignId: string;
  rewardId: string | null;
  entryType: LedgerEntryType;
  amountMicroUsdc: bigint;
  createdAt: Date;
}
```

---

## @spark/campaign — CampaignEngine

### Public Interface
```ts
export interface CampaignEngine {
  // Create campaign in DRAFT
  createCampaign(input: CreateCampaignInput): Promise<CampaignRow>;

  // Configure target chat (id, username, title)
  configureChat(campaignId: string, chat: ChatConfig): Promise<CampaignRow>;

  // Configure rewards
  setRewards(campaignId: string, rewards: RewardsConfig): Promise<CampaignRow>;

  // Set budget
  setBudget(campaignId: string, budgetMicroUsdc: bigint, maxParticipants: number | null): Promise<CampaignRow>;

  // Fund campaign: operator deposits USDC to CampaignEscrow
  fundCampaign(campaignId: string, amountMicroUsdc: bigint): Promise<CampaignRow>;

  // Activate: requires funded_balance >= required minimum
  activateCampaign(campaignId: string): Promise<CampaignRow>;

  // Pause/resume
  pauseCampaign(campaignId: string): Promise<CampaignRow>;
  resumeCampaign(campaignId: string): Promise<CampaignRow>;

  // Close/cancel
  closeCampaign(campaignId: string): Promise<CampaignRow>;
  cancelCampaign(campaignId: string): Promise<CampaignRow>;

  // Stats
  getCampaignStats(campaignId: string): Promise<CampaignStats>;
}
```

### Status Transitions
```
DRAFT → fundCampaign (→ FUNDING) → activateCampaign (funded >= min) → ACTIVE
ACTIVE → pauseCampaign → PAUSED
PAUSED → resumeCampaign → ACTIVE
ACTIVE → closeCampaign → CLOSED (or EXHAUSTED if budget spent)
ACTIVE → cancelCampaign → CANCELLED
```

### Funding
- Separate `fundCampaign` step: operator calls `CampaignEscrow.deposit` with creator's signed permit + transfer
- `fundedMicroUsdc` tracked on-chain (via CampaignEscrow events) and mirrored in DB
- Activation requires `fundedMicroUsdc >= requiredMinimum` (configurable, default = userReward * estimated participants + buffer)

---

## @spark/referral — ReferralEngine

### Public Interface
```ts
export interface ReferralEngine {
  // Generate deep link for campaign
  generateReferralLink(campaignPublicId: string, referrerTelegramUserId: bigint): Promise<ReferralLink>;

  // Called at /api/auth/telegram when initData includes referralCode
  attributeReferral(input: AttributionInput): Promise<ReferralRow | null>;

  // Freeze attribution when user first participates
  freezeAttribution(campaignId: string, referredUserId: string): Promise<void>;

  // Qualify referral after referred user verification
  qualifyReferral(campaignId: string, referredUserId: string): Promise<ReferralRow>;

  // Get referral stats
  getReferralStats(campaignId: string): Promise<ReferralStats>;
}

export interface ReferralLink {
  deepLink: string;        // https://t.me/bot/app?startapp=c_<publicId>_<referralCode>
  startapp: string;        // c_<publicId>_<referralCode>
  referralCode: string;
}
```

### Attribution Rules (per PRD §19-§20)
1. **At auth**: when user opens referral link, Mini App parses `startapp=c_<publicId>_<referralCode>` and sends `referralCode` with `initData` to `/api/auth/telegram`
2. **Backend**: resolves referralCode → campaign + referrer; creates Referral row with status `ATTRIBUTED`
3. **Constraints**:
   - Unique: `(campaignId, referredUserId)` — one referrer per user per campaign
   - Self-referral prohibited: `referrerUserId !== referredUserId`
   - First attribution wins: subsequent links don't overwrite
   - Idempotent: repeat auth with same code = no-op
4. **Freeze**: when user first participates (creates Participation row), attribution is frozen
5. **Qualify**: after user verification (`POST /verify` succeeds), referral transitions `ATTRIBUTED` → `QUALIFIED`

---

## @spark/reward — RewardEngine

### Public Interface
```ts
export interface RewardEngine {
  // Called after successful verification
  checkAndAuthorizeRewards(campaignId: string, participationId: string): Promise<RewardRow[]>;

  // Settlement worker calls this
  getAuthorizedRewards(limit: number): Promise<RewardRow[]>;

  // Reconciliation
  markSubmitted(rewardId: string, txHash: string): Promise<void>;
  markConfirmed(rewardId: string): Promise<void>;
  markPaid(rewardId: string): Promise<void>;
  markFailed(rewardId: string, reason: string): Promise<void>;
}
```

### State Machine (per PRD §22)
```
ELIGIBLE → authorize → AUTHORIZED (nonce assigned, budget reserved)
AUTHORIZED → worker submits → SUBMITTED (txHash persisted)
SUBMITTED → on-chain confirm → CONFIRMED
CONFIRMED → PAID

Failure paths:
AUTHORIZED → SUBMISSION_FAILED → RETRYING → SUBMITTED
SUBMITTED → FAILED
```

### Authorization (per PRD §23-§24)
- **Atomic budget reservation**: when creating reward row, decrement `campaign.paidMicroUsdc` (reserved) and increment `campaign.paidMicroUsdc` on `PAID`
- **Nonce**: unique `authorizationNonce` per reward (bigint, monotonic per campaign)
- **Idempotency**: unique constraint on `(campaignId, participationId, rewardType)` prevents duplicate rewards
- **Expiry**: `authorizationExpiresAt` (e.g., 7 days) — worker skips expired authorizations

---

## Settlement Worker (@spark/reward or separate @spark/worker)

### Flow
1. Poll `RewardEngine.getAuthorizedRewards(limit)` for `AUTHORIZED` rewards
2. For each reward:
   - Call `CampaignEscrow.payReward(campaignId, rewardId, nonce, recipient, amount, deadline)`
   - Contract checks: operator permission, campaign status, payout limits, available balance, nonce replay protection
   - On success: persist `transactionHash`, mark `SUBMITTED`
3. Reconciliation loop:
   - Watch `RewardPaid` events from CampaignEscrow
   - Mark reward `CONFIRMED` → `PAID`
   - Create LedgerEntry (USER_REWARD / REFERRAL_REWARD)
   - Handle retries: inspect contract state before resubmitting, nonce prevents double-pay

### Contract Interface (CampaignEscrow)
```solidity
function payReward(
  uint256 campaignId,
  uint256 rewardId,
  uint256 nonce,
  address recipient,
  uint256 amount,
  uint256 deadline
) external onlyOperator returns (bool);
```

---

## Database Migrations (packages/db)

### Tables
- `campaigns` (extends existing with new status enum values)
- `tasks` (already exists, TELEGRAM_CHANNEL_MEMBERSHIP type)
- `referrals` (new)
- `participations` (new)
- `rewards` (new)
- `ledger_entries` (new)

### Constraints
```sql
-- Referrals
UNIQUE(campaign_id, referred_user_id)
CHECK (referrer_user_id != referred_user_id)

-- Rewards
UNIQUE(campaign_id, participation_id, reward_type)

-- Budget
CHECK (paid_micro_usdc <= budget_micro_usdc)
```

---

## API Endpoints (apps/api)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/campaigns` | Create campaign (DRAFT) |
| PATCH | `/api/campaigns/:publicId` | Configure chat, rewards, budget |
| POST | `/api/campaigns/:publicId/fund` | Fund campaign |
| POST | `/api/campaigns/:publicId/activate` | Activate campaign |
| POST | `/api/campaigns/:publicId/pause` | Pause |
| POST | `/api/campaigns/:publicId/resume` | Resume |
| POST | `/api/campaigns/:publicId/close` | Close |
| GET | `/api/campaigns/:publicId/stats` | Campaign statistics |
| POST | `/api/campaigns/:publicId/verify` | Verify participation (existing, updated to create rewards) |

---

## Mini App (apps/telegram-mini-app)

- Parses `startapp` referralCode at launch
- Sends `referralCode` with `initData` to `/api/auth/telegram`
- Displays campaign UI, Verify button, referral link sharing
- Shows reward status (eligible, pending, paid)

---

## Bot (apps/bot)

- Generates referral deep links via `ReferralEngine.generateReferralLink`
- Sends notifications on reward payouts
- Campaign admin commands (fund, activate, pause, close)

---

## Security Considerations

1. **Operator wallet only** submits payouts — `CampaignEscrow` restricts to operator role
2. **Budget reserved atomically** at authorization — prevents overspend
3. **Nonce replay protection** on-chain — duplicate submissions rejected
4. **Referral attribution frozen** at first participation — prevents switching
5. **Self-referral blocked** at DB + application layer
6. **Verification only via server session** — never trust client-sent identity

---

## Implementation Order

1. `@spark/domain` types + enums
2. `@spark/db` repositories + migrations
3. `@spark/campaign` engine + API endpoints
4. `@spark/referral` engine + auth integration
5. `@spark/reward` engine + settlement worker
6. Mini App + Bot integration
7. Full verification + docs