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

Spark's product vision is broader than the current MVP. The repository contains several backend and contract building blocks, but the Telegram Mini App and supported action types are still limited. The sections below distinguish existing code from planned product capabilities.

### Implemented building blocks

- **Telegram identity:** server-side validation of Telegram Mini App `initData` and session-based API authentication.
- **Campaign domain:** PostgreSQL campaign records, campaign lifecycle states, budget and reward fields, participant limits, and campaign lifecycle logic/API endpoints.
- **Task persistence:** campaigns can have task records with typed task kinds and task-specific configuration. The currently defined task type is **Telegram channel membership**.
- **Membership verification:** a Telegram-based participation and channel-membership verification path.
- **Referrals:** campaign-specific referral codes and Telegram deep links, with referral attribution and qualification logic.
- **Reward lifecycle:** reward and participation state models, database records and worker logic for payout submission, retry handling and chain reconciliation.
- **Escrow contract:** a Foundry project for campaign funding and reward payouts, with unit, fuzz and invariant tests.

These are code-level capabilities, not a claim that every flow has been validated in a production deployment.

### Current Mini App limitations

The participant interface is still a prototype focused on verifying Telegram channel membership. It does **not yet** provide the complete campaign experience described in the vision above.

Not yet implemented as a complete end-to-end product:

- A participant-facing campaign directory and multi-task campaign detail page.
- A creator-facing campaign builder for adding multiple action types and configuring each action's verification criteria.
- Social-post URL submission and creator review workflows.
- A complete referral progress view and participant rewards dashboard.
- A production-ready, end-to-end wallet and payout experience in the Mini App.

The current task model is extensible in principle, but the application does not yet support arbitrary task types. Do not assume that X posts, follows, website visits, surveys or custom submissions can already be created and verified.

### Prototype and production caveats

Some wallet and payout controls in the Mini App are prototype code and must not be treated as proof of a real wallet connection or confirmed reward payment. The UI and settlement API need to be connected to the campaign reward authorization and settlement pipeline before being used for real-value payouts.

Campaign creation, ownership checks, funding confirmation, reward authorization and on-chain reconciliation also require end-to-end verification and security hardening before production use. A database status update or submitted transaction is not proof of confirmed on-chain funding or payment.

### Product direction

The next product milestone is a minimal Telegram-first campaign workflow:

1. Let a creator configure a campaign and its supported actions.
2. Let participants discover a campaign and see its requirements and rewards.
3. Support task-specific completion and verification, starting with Telegram membership and then referral and evidence-based tasks.
4. Track task approval separately from reward authorization and settlement.
5. Show pending, failed and paid reward states accurately.
6. Expand to additional platforms only when the corresponding verification and attribution methods are reliable.

The longer-term vision remains cross-platform: campaigns should eventually support actions and distribution across X and other communities without making Telegram-specific assumptions part of the core campaign model.

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
