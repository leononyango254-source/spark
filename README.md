# Spark — Performance Marketing & On-Chain Rewards

**Turn online attention into measurable outcomes. Reward the people who make them happen.**

Spark is a cross-platform performance marketing and rewards platform for brands, creators, influencers, communities and digital products. Campaign owners define an action they want people to take, distribute the campaign across social channels, verify qualifying outcomes and reward participants in USDC.

The vision goes beyond a traditional bounty board or a social quest page. Spark is being built to connect **campaign distribution, task verification, referral attribution and on-chain rewards** in one system. Telegram is the initial user experience and distribution channel; the longer-term architecture is intended to support campaigns discovered and shared through X and other online communities.

**The core idea:** pay for verified outcomes, not just impressions, clicks or promises.

> A creator shares a campaign. A participant completes a task. Spark verifies the result. The right people receive their rewards.

## Why Spark?

Online marketing is spread across creators, social platforms, group chats, referral links and campaign tools. Brands may pay for reach without knowing whether it produced useful actions. Creators often lack a simple way to run performance-based promotions. Users are asked to complete tasks, but reward rules and payouts can be fragmented or difficult to trust.

Spark aims to make those relationships easier to coordinate:

- **For campaign owners:** define an outcome, set eligibility rules and a budget, then track verified completions and reward spend.
- **For influencers and creators:** distribute campaigns to an audience and participate in performance-based campaigns rather than relying only on flat-fee promotions.
- **For communities:** run quests, referral drives, giveaways and contributor bounties with clear rules.
- **For participants:** understand the task and reward up front, complete qualifying actions and receive USDC rewards.
- **For developers and digital products:** use a common campaign and reward workflow to acquire users or encourage specific actions.

USDC provides a familiar dollar-denominated reward. Arc provides the intended on-chain settlement rail, while application logic handles campaign rules and verification.

## Use cases

### 1. Influencer and channel campaigns

A project or brand funds a campaign and asks creators, channel owners or community admins to distribute it.

**Example:** A wallet app allocates $1,000 to acquire new users. Influencers share unique campaign links. Participants complete onboarding and a qualifying action. The campaign dashboard tracks eligible conversions, spend and cost per verified user.

The goal is to move beyond paying only for a post or a view and toward measurable campaign outcomes. Influencer fees, participant rewards and platform fees can be represented as distinct parts of a campaign as the product evolves.

### 2. Telegram community growth

A project launches a campaign asking users to join an official channel or complete another supported community action.

**Example:** A community sets aside $200 USDC to reward eligible new members. Spark verifies Telegram identity and channel membership, applies campaign limits and records qualifying participants before rewards are settled.

Telegram is the first integration because it combines distribution, identity context and communities in one place.

### 3. Referral and ambassador programs

Campaign owners reward participants who bring in new users, with referral credit tied to a qualifying action rather than a click alone.

**Example:** A participant shares a personal referral link. A friend joins, completes the campaign task and passes eligibility checks. The friend earns the participant reward; the referrer earns a separately defined bonus.

Referral rules can specify attribution windows, one-level or multi-level limits, per-user caps and conditions for rejecting duplicate or self-referrals. These controls are essential to prevent reward farming.

### 4. Quests, bounties and microtasks

Communities, protocols, games and digital products can define small tasks with explicit acceptance criteria and rewards.

Examples include:
- Answer a product or community quiz.
- Complete onboarding or try a new feature.
- Submit a translation, design, bug report or piece of content for review.
- Complete a survey or provide structured feedback.
- Participate in a community event or learning campaign.

Not every task can be verified automatically. Some actions may need a platform integration, an external proof or human review before a reward is authorized.

### 5. USDC giveaways and community rewards

A community admin funds a distribution campaign and publishes its eligibility rules.

**Example:** A channel runs a $100 USDC giveaway for participants who meet defined requirements. Spark records entries, applies campaign limits and supports a transparent reward workflow.

Giveaway mechanics may include fixed rewards, capped distributions or eligible-participant draws. Random selection, eligibility and payout rules must be clearly defined; a public record of a payout alone does not prove that a campaign was fair.

### 6. X and cross-platform campaigns

The long-term vision is to let campaigns travel wherever their audiences are, instead of tying the product to one social platform.

**Example:** A project posts a campaign on X, an influencer shares it in Telegram, and participants arrive through platform-specific links. Spark attributes referrals and campaign sources, then applies the same eligibility and reward rules across supported entry points.

Verification depends on the action. Some tasks may be verified through platform APIs or connected accounts; others may require a signed submission, an external integration or manual review. Spark should not claim to verify a like, follow or view unless it has a reliable way to do so.

## How it works

1. **Create a campaign.** The owner defines the objective, task, eligibility criteria, reward, budget and campaign period.
2. **Distribute it.** Share a campaign link through Telegram, X, creators, communities or other supported channels.
3. **Record participation.** Spark associates the participant with the campaign and captures relevant attribution information.
4. **Verify the outcome.** The system checks the required action using the available platform integration or review process.
5. **Authorize the reward.** Campaign rules, limits and anti-abuse checks determine whether the participant qualifies.
6. **Settle and reconcile.** The settlement service submits the payout to Arc and reconciles the transaction receipt and resulting state.
7. **Measure performance.** Campaign owners can track participation, verified outcomes, reward spend and referral performance as the relevant analytics are implemented.

## Product principles

- **Outcome-based:** reward defined, qualifying actions rather than raw attention alone.
- **Multi-channel by design:** Telegram is the starting point, not the product boundary.
- **Clear reward rules:** eligibility, reward amounts, limits and campaign periods should be understandable before participation.
- **Verification before payment:** a submitted task is not automatically a valid task.
- **USDC-denominated:** express campaign budgets and rewards in dollar terms.
- **On-chain settlement:** use Arc for the intended USDC payout path, with application-side accounting and transaction reconciliation.
- **Abuse-aware:** design for duplicate accounts, self-referrals, referral farming, bot activity and campaign-budget exhaustion.
- **Honest about verification:** support only the proofs that the implementation can reliably check.

## Current implementation status

The current Telegram multi-action campaign implementation adds a campaign builder and participant task flows while keeping campaign actions and evidence off-chain. This section describes the reported implementation state; validate the end-to-end flows and deployment configuration before using real funds.

### Implemented

- **Campaign creation:** creators can create draft campaigns through the Telegram Mini App. The API routes requests through `CampaignEngine` and persists a campaign with multiple typed actions.
- **Action types:** `TELEGRAM_JOIN`, `SOCIAL_POST` and `REFERRAL`.
- **Per-action configuration:** title, instructions, platform, verification method, reward amount, completion cap, active state and display order.
- **Participant workflows:** browse campaigns, view campaign details, start or check Telegram actions, submit social-post evidence, view task status and view rewards.
- **Telegram membership verification:** membership is checked server-side using the configured Telegram integration.
- **Social-post review:** post evidence remains pending until a creator reviews it; submissions are not automatically treated as verified.
- **Referral links and attribution:** participants can fetch campaign referral links. Referral rewards are assigned by the server to the referrer, not the referred participant.
- **Creator and participant navigation:** the Mini App includes Explore, My tasks, Rewards, Account and Creator sections.
- **Task review data:** action participation records support evidence, review status, reviewer identity and rejection reasons.
- **Campaign participant caps:** a participant reservation record ensures a participant consumes the campaign-level participant cap once, even when completing multiple actions.
- **Reward authorization:** approved actions use the existing budget/cap reservation flow. Failed reservations release temporary action-cap and participant reservations.
- **Settlement lifecycle:** the worker submits payouts; the reward is marked paid only after reconciliation processes the on-chain `RewardPaid` event.
- **Funding controls:** funding remains operator-confirmed. The seed script sends escrow transactions and records funding after transaction receipts; the API cannot mark a campaign funded merely because a client requests it.
- **Database migration:** migration `0007_multi_action_campaigns.sql` adds the multi-action campaign structures.

### Verification status

The reported checks for this implementation are:

- `pnpm typecheck` — passed.
- `pnpm build` and the Mini App build — passed.
- `git diff --check` — passed.
- `pnpm lint` — failed due to existing repository-wide lint debt, with additional UI style warnings.
- Database-backed tests — blocked by the local test-container hostname/DNS issue (`ENOTFOUND localhost`); these tests have not been verified as passing.
- Foundry tests — blocked because `contracts/lib/forge-std` is missing. Install it with `forge install foundry-rs/forge-std --no-commit`, then rerun the contract suite.

These results were reported by the implementation workflow and have not been independently rerun as part of this README update.

### Known gaps and production caveats

- **Creator review UI:** the secured review API exists, but the Mini App does not yet expose the full approve/reject console for social evidence.
- **Funding UX:** funding is intentionally operator-confirmed; a complete creator self-service on-chain funding flow is not yet available.
- **Database-backed integration tests:** action and reward integration behavior still needs to be verified against a working test database.
- **Contract validation and deployment:** the current source contract's hardening must be deployed separately if the live escrow predates that version. Updating source code does not change an already deployed contract.
- **Real wallet and settlement configuration:** configure and verify the actual WalletConnect, worker and chain credentials before presenting wallet or payout flows as production-ready.
- **Migration:** apply `0007_multi_action_campaigns.sql` through a direct database connection before running the updated application against that database.

A submitted task is not automatically approved, an approved task is not automatically paid, and a submitted transaction is not proof of confirmed settlement.

### Smart-contract boundary

No Solidity changes were required for the multi-action campaign phase. Action definitions, participant evidence and creator reviews remain off-chain. The existing escrow is used for common reward settlement rather than deploying a separate contract for every action type. The escrow must still enforce the necessary funding and payout invariants, and the deployed version must be checked before real funds are used.

### Next steps

1. Apply the database migration and run the database-backed action/reward integration suite.
2. Restore `forge-std` and run the Foundry test suite.
3. Add creator-facing approve/reject controls for social-post evidence.
4. Verify the deployed escrow address and version against the hardened source contract.
5. Configure and test Telegram membership permissions, WalletConnect and worker settlement credentials.
6. Complete an end-to-end test on the intended Arc network before enabling real-value payouts.

The product remains cross-platform by design, but only the action types with implemented verification or review paths should be presented as supported. X and other platforms require their own reliable verification and attribution integrations before they can be advertised as automated actions.

## Architecture at a glance

- **User experiences and distribution:** Telegram Mini App and bot first; web and other platform entry points can be added.
- **API and domain logic:** campaign management, participation, referrals, eligibility and reward authorization.
- **Verification integrations:** Telegram membership initially, with additional platform-specific verification as supported.
- **PostgreSQL:** campaign state, participant records, reward lifecycle and accounting data.
- **Background worker:** payout submission, retries and chain reconciliation.
- **CampaignEscrow:** on-chain campaign funding and payout controls.
- **Arc + USDC:** intended settlement network and reward asset.

See [docs/PRD.md](docs/PRD.md) for requirements, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design, [docs/SECURITY.md](docs/SECURITY.md) for security boundaries and [docs/CONTRACT.md](docs/CONTRACT.md) for escrow design and deployment notes.

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
  reward/              Reward authorization and settlement lifecycle
  rewards/             Reward and participation state machines
  referral/            Referral codes, attribution and qualification
  campaign/            Campaign lifecycle and configuration logic
  ledger/              Append-only ledger types
  db/                  Drizzle schema and migrations
worker/                Background jobs (settlement, reconciliation)
contracts/             Foundry project (CampaignEscrow.sol)
docs/                  PRD, architecture, security and contract notes
spikes/                Integration experiments and evidence
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
- Do not treat an action as verified unless the relevant integration or review process provides adequate evidence.

## Roadmap

1. **Prove the core loop:** campaign creation, task verification, reward authorization and reliable USDC settlement.
2. **Strengthen referrals and measurement:** attribution, duplicate prevention, conversion reporting and cost per verified action.
3. **Expand campaign formats:** quests, surveys, content submissions, bounties and giveaways with suitable verification.
4. **Add distribution integrations:** support X and other channels where their verification and attribution requirements can be met.
5. **Build creator and campaign discovery:** help campaign owners find distribution partners and help creators find relevant offers.

Spark's ambition is to make digital campaigns more accountable: connect distribution to verifiable actions, and connect those actions to transparent reward rules and reliable payouts.
