# **Telegram USDC Campaigns on Arc**

## **MVP Product Requirements & Technical Specification**

**Status:** Implementation-ready specification  
**Target:** Arc Mainnet  
**Primary interface:** Telegram Mini App  
**Settlement asset:** USDC  
**Primary settlement network:** Arc  
**MVP task:** Telegram channel membership  
**MVP reward types:** User completion \+ one-level referral

---

# **1\. Product Definition**

## **1.1 Product thesis**

A Telegram-native performance marketing and rewards platform where campaign creators fund campaigns in USDC, users complete verified actions, and successful actions trigger programmable USDC rewards settled on Arc.

The core loop is:

Campaign creator  
      ↓  
Create campaign  
      ↓  
Fund campaign with USDC  
      ↓  
Distribute campaign through Telegram  
      ↓  
User opens Mini App  
      ↓  
User completes required action  
      ↓  
Platform verifies action  
      ↓  
Reward becomes eligible  
      ↓  
USDC settlement on Arc  
      ↓  
User / referrer receives reward

The product is **not** a generic bounty marketplace in MVP.

It is a:

> **Telegram-native programmable acquisition and rewards engine using Arc as the financial settlement layer.**

---

# **2\. MVP Objective**

Demonstrate a complete, real-money campaign lifecycle:

1. A campaign creator creates a campaign.  
2. The campaign defines a Telegram channel as its target.  
3. The creator funds the campaign with USDC.  
4. A user enters through a Telegram campaign link.  
5. Telegram identity is authenticated server-side.  
6. The user joins the target channel.  
7. The backend verifies membership using Telegram's Bot API.  
8. The user becomes eligible for a reward.  
9. The reward is settled in USDC on Arc.  
10. A referred user can independently complete the same task.  
11. The original referrer receives a referral reward.  
12. The campaign dashboard reflects the complete financial state.

Telegram officially supports Mini Apps, `startapp` parameters for direct-link attribution, and server-side validation of `initData`.

Telegram's `getChatMember` is suitable for the MVP membership verifier, with the important requirement that the bot is an administrator in the target chat for reliable lookup of other users.

---

# **3\. Explicit MVP Scope**

## **3.1 Included**

### **Campaigns**

* Create campaign  
* Configure target Telegram channel  
* Configure user reward  
* Configure referral reward  
* Configure campaign budget  
* Pause campaign  
* Resume campaign  
* Close campaign  
* View campaign statistics

### **User participation**

* Telegram authentication  
* Campaign discovery/opening  
* Wallet/address association  
* Join target Telegram channel  
* Verify membership  
* Receive completion reward  
* Generate referral link  
* Receive referral reward

### **Blockchain**

* Arc mainnet  
* USDC  
* Campaign escrow  
* Reward settlement  
* On-chain events  
* Transaction reconciliation

### **Referral**

* One referral level only  
* One referrer per referred user per campaign  
* Referral reward only after referred user completes the campaign task

### **Operations**

* Internal ledger  
* Reward state machine  
* Idempotency  
* Retry handling  
* Reconciliation  
* Basic campaign limits  
* Audit trail

---

# **4\. Explicitly Out of Scope**

Do NOT implement:

* Multiple task types  
* Telegram reactions  
* Telegram comments  
* Surveys  
* Quizzes  
* Purchases  
* Content creation  
* Retention tasks  
* Influencer marketplace  
* Creator marketplace  
* Multi-level referrals  
* Reputation system  
* Token  
* DAO  
* Governance  
* AI fraud detection  
* ML scoring  
* Cross-chain campaign settlement  
* Bridges  
* Swaps  
* Yield  
* Lending  
* Arbitrage  
* Automated influencer discovery  
* Complex affiliate economics  
* Platform tokenomics

The backend should expose abstractions that allow these later, but they must not expand the MVP implementation.

---

# **5\. Core Actors**

## **5.1 Campaign Creator**

Creates and funds campaigns.

Responsibilities:

* define campaign  
* provide target Telegram channel  
* fund campaign  
* configure rewards  
* pause/close campaign

The creator controls the campaign budget.

---

## **5.2 Participant**

A Telegram user who completes campaign tasks.

Responsibilities:

* open campaign  
* authenticate Telegram identity  
* associate a wallet/address  
* join target channel  
* request verification  
* receive reward  
* optionally refer other users

---

## **5.3 Referrer**

A participant who brings another user into the campaign.

The referrer receives a fixed campaign-defined reward only after the referred user independently satisfies the campaign eligibility condition.

---

## **5.4 Telegram Bot**

Responsible for:

* launching Mini App  
* campaign links  
* Telegram interaction  
* membership verification  
* sending notifications  
* identifying target chats

---

## **5.5 Backend**

System authority for:

* Telegram identity validation  
* campaign state  
* task verification  
* eligibility  
* referral attribution  
* reward calculation  
* ledger  
* reward authorization  
* reconciliation

The backend does **not** become the financial source of truth.

---

## **5.6 Arc**

Financial settlement layer.

Arc provides:

* USDC-native gas  
* EVM compatibility  
* predictable stablecoin-denominated fees  
* deterministic sub-second settlement finality.

---

# **6\. Product Architecture**

                        TELEGRAM  
                            │  
             ┌──────────────┴──────────────┐  
             │                             │  
        Telegram Bot                 Telegram Mini App  
             │                             │  
             └──────────────┬──────────────┘  
                            │  
                            ▼  
                    APPLICATION BACKEND  
                            │  
             ┌──────────────┼──────────────┐  
             │              │              │  
        Campaign        Verification    Referral  
         Engine            Engine         Engine  
             │              │              │  
             └──────────────┼──────────────┘  
                            │  
                            ▼  
                     Reward Engine  
                            │  
                            ▼  
                    Internal Ledger  
                            │  
                            ▼  
                  Reward Authorization  
                            │  
                            ▼  
                       ARC MAINNET  
                            │  
                     Campaign Escrow  
                            │  
                     Native Arc USDC  
                      /             \\  
                     /               \\  
                    ▼                 ▼  
              Participant         Referrer  
                wallet              wallet

---

# **7\. Architectural Principles**

## **7.1 Telegram is the identity/verification layer**

Telegram establishes:

telegram\_user\_id

The backend validates the authenticity of the Telegram session.

Do not trust:

initDataUnsafe

Telegram explicitly requires server-side validation of raw `initData`.

---

## **7.2 Backend is the eligibility authority**

The backend determines:

Did the user complete the required action?

The blockchain does not attempt to understand Telegram.

---

## **7.3 Arc is the financial authority**

The blockchain determines:

Was the reward actually settled?

The database must never claim a reward is paid solely because the backend intended to pay it.

---

## **7.4 Telegram and blockchain remain decoupled**

The smart contract must know nothing about:

* Telegram  
* usernames  
* Telegram IDs  
* channels  
* messages  
* referral links

It only handles:

* campaign balances  
* reward authorization  
* payout  
* replay protection  
* campaign limits  
* refunds

---

# **8\. Telegram Integration**

## **8.1 Mini App**

The product uses a Telegram Mini App as the participant interface.

Telegram supports direct Mini App links such as:

https://t.me/\<bot\>/\<app\>?startapp=\<payload\>

The `startapp` value is passed into the Mini App as the campaign/referral parameter.

---

## **8.2 Campaign link**

Canonical conceptual format:

https://t.me/rewardbot/app?startapp=c\_\<campaign\_id\>\_\<referral\_code\>

The exact encoding should be compact and opaque.

Do not expose sensitive internal database identifiers if avoidable.

Example:

c\_8\_f7K2p

means:

campaign \= 8  
referral\_code \= f7K2p

---

# **9\. Telegram Authentication**

On Mini App launch:

Telegram.WebApp.initData

is sent to:

POST /api/auth/telegram

Backend:

1. Parse raw query string.  
2. Validate Telegram signature.  
3. Validate `auth_date`.  
4. Extract Telegram user.  
5. Create/update internal user.  
6. Establish application session.

Telegram documents the HMAC-SHA-256 verification process and explicitly states that `initDataUnsafe` must not be trusted.

---

# **10\. Telegram User Model**

User  
├── id  
├── telegram\_user\_id  
├── telegram\_username  
├── display\_name  
├── wallet\_address  
├── wallet\_provider  
├── wallet\_status  
├── created\_at  
└── updated\_at

`telegram_user_id` must be stored as a sufficiently large integer type.

Telegram documents that chat IDs/user IDs can exceed 32-bit integer ranges.

---

# **11\. Campaign Model**

Campaign  
├── id  
├── public\_id  
├── creator\_id  
├── name  
├── description  
├── target\_chat\_id  
├── target\_chat\_username  
├── target\_chat\_title  
├── user\_reward\_micro\_usdc  
├── referral\_reward\_micro\_usdc  
├── budget\_micro\_usdc  
├── funded\_micro\_usdc  
├── paid\_micro\_usdc  
├── status  
├── max\_participants  
├── participant\_count  
├── starts\_at  
├── ends\_at  
├── created\_at  
└── updated\_at

Campaign status:

DRAFT  
FUNDING  
ACTIVE  
PAUSED  
EXHAUSTED  
CLOSED  
CANCELLED

---

# **12\. Campaign Invariants**

A campaign cannot become `ACTIVE` unless:

funded\_balance \>= required minimum

A campaign cannot pay if:

status \!= ACTIVE

A campaign cannot pay more than:

budget\_micro\_usdc

A campaign cannot exceed:

max\_participants

A campaign cannot modify reward amounts after the first participant is approved.

This prevents historical reward ambiguity.

---

# **13\. MVP Task Model**

Although only one task is implemented, use a generic task abstraction.

Task  
├── id  
├── campaign\_id  
├── type  
├── config  
├── reward\_micro\_usdc  
├── status  
└── created\_at

MVP:

type \= TELEGRAM\_CHANNEL\_MEMBERSHIP

Example config:

{  
  "chat\_id": "-1001234567890",  
  "chat\_username": "@example"  
}

---

# **14\. Task Verification Interface**

Conceptual interface:

TaskVerifier  
    verify(user, task) \-\> VerificationResult

MVP implementation:

TelegramChannelMembershipVerifier

Future implementations could include:

TelegramReactionVerifier  
QuizVerifier  
SurveyVerifier  
PurchaseVerifier  
WebhookVerifier  
RetentionVerifier

Do not implement them now.

---

# **15\. Membership Verification**

Backend calls:

getChatMember(  
    chat\_id,  
    user\_id  
)

Telegram states this method is only guaranteed to work for other users when the bot is an administrator in the relevant chat.

Therefore campaign creation must require:

> The Reward Bot must be an administrator of the target channel/group.

Campaign validation should verify this before allowing launch.

---

# **16\. Valid Membership States**

Accept:

member  
administrator  
creator

Potentially acceptable:

restricted

only if the user is still a current member according to Telegram's returned fields.

Do not simply check that the API call succeeded.

The verifier must explicitly evaluate the returned `ChatMember` state.

Reject:

left  
kicked

---

# **17\. Verification Endpoint**

POST /api/campaigns/{campaign\_id}/verify

Request:

{  
  "task\_id": "..."  
}

Server derives the user from the authenticated Telegram session.

Never accept:

user\_id  
telegram\_user\_id  
wallet\_address

from the client as authoritative identity fields.

---

# **18\. Verification State**

Participation  
├── id  
├── campaign\_id  
├── user\_id  
├── task\_id  
├── referral\_code\_used  
├── referrer\_user\_id  
├── status  
├── verified\_at  
├── reward\_id  
└── created\_at

Status:

STARTED  
PENDING\_VERIFICATION  
VERIFIED  
REWARD\_PENDING  
REWARDED  
REJECTED

---

# **19\. Referral Attribution**

A referral is created when:

User B  
opens campaign through  
User A's referral link

The referral is stored before task completion.

Example:

Referral  
├── campaign\_id  
├── referrer\_user\_id  
├── referred\_user\_id  
├── referral\_code  
├── created\_at  
└── status

---

# **20\. Referral Rules**

MVP rules:

1. One referrer per user per campaign.  
2. Self-referral prohibited.  
3. Referral attribution occurs before completion.  
4. Attribution cannot be changed after the referred user begins/completes the task.  
5. Referral reward is only created after referred user becomes eligible.  
6. Referral reward is independent of the user's own reward.  
7. Only one referral level exists.

Thus:

Alice → Bob

is valid.

But:

Alice → Bob → Charlie

does not create a second-level reward.

---

# **21\. Reward Model**

Reward  
├── id  
├── campaign\_id  
├── participation\_id  
├── reward\_type  
├── recipient\_user\_id  
├── recipient\_wallet  
├── amount\_micro\_usdc  
├── authorization\_nonce  
├── authorization\_expires\_at  
├── status  
├── chain\_id  
├── transaction\_hash  
├── created\_at  
├── submitted\_at  
├── confirmed\_at  
└── failed\_at

Reward types:

USER\_COMPLETION  
REFERRAL

---

# **22\. Reward State Machine**

ELIGIBLE  
   ↓  
AUTHORIZED  
   ↓  
SUBMITTED  
   ↓  
CONFIRMED  
   ↓  
PAID

Failure paths:

AUTHORIZED  
    ↓  
SUBMISSION\_FAILED  
    ↓  
RETRYING  
    ↓  
SUBMITTED

or:

SUBMITTED  
    ↓  
FAILED

A failed reward must remain visible and recoverable.

---

# **23\. Reward Idempotency**

Every reward gets a unique:

reward\_id

and:

authorization\_nonce

The contract must reject reuse of an already-consumed authorization.

Database constraints must also prevent duplicate reward creation.

Example:

UNIQUE(campaign\_id, participation\_id, reward\_type)

for the MVP.

---

# **24\. Financial Ledger**

Create an append-only ledger.

LedgerEntry  
├── id  
├── campaign\_id  
├── reward\_id  
├── entry\_type  
├── amount\_micro\_usdc  
├── direction  
├── reference  
├── created\_at

Entry types:

CAMPAIGN\_FUNDING  
USER\_REWARD  
REFERRAL\_REWARD  
CAMPAIGN\_REFUND

Never update historical ledger entries.

Corrections are represented by compensating entries.

---

# **25\. Financial Invariant**

For every campaign:

funded  
\=  
user\_rewards\_paid  
\+  
referral\_rewards\_paid  
\+  
refunds  
\+  
remaining\_balance

The application must periodically compare its internal accounting against the campaign contract.

---

# **26\. USDC Representation**

All application monetary values are integer micro-USDC:

\$0.10 \= 100000  
\$0.50 \= 500000  
\$1.00 \= 1000000  
\$25.00 \= 25000000

Do not use floating point.

Arc's current Circle skill specifies USDC as 6-decimal ERC-20 representation and provides the Arc USDC predeploy:

0x3600000000000000000000000000000000000000

for both Arc mainnet and testnet.

The implementation must keep application accounting in the 6-decimal representation.

---

# **27\. Arc Configuration**

chain\_id \= 5042

rpc:  
https://rpc.mainnet.arc.io

testnet\_chain\_id \= 5042002

testnet\_rpc:  
https://rpc.testnet.arc.io

USDC:  
0x3600000000000000000000000000000000000000

Arc's current Circle skill documents these network parameters and explicitly recommends using testnet during development.

---

# **28\. Smart Contract**

Create:

CampaignEscrow.sol

The contract should be intentionally small.

Responsibilities:

* create campaign  
* accept campaign funding  
* track campaign balance  
* authorize reward  
* prevent duplicate claims  
* pay recipient  
* close campaign  
* refund remaining funds  
* emit events

The contract does NOT:

* validate Telegram  
* calculate referrals  
* query APIs  
* determine campaign eligibility  
* store usernames  
* store Telegram IDs

---

# **29\. Proposed Contract Interface**

Conceptual interface:

interface ICampaignEscrow {

    function createCampaign(  
        uint256 campaignId,  
        uint256 budget  
    ) external;

    function fundCampaign(  
        uint256 campaignId,  
        uint256 amount  
    ) external;

    function claimReward(  
        uint256 campaignId,  
        uint256 rewardId,  
        address recipient,  
        uint256 amount,  
        uint256 nonce,  
        uint256 expiry,  
        bytes calldata authorization  
    ) external;

    function closeCampaign(  
        uint256 campaignId  
    ) external;

    function refundCampaign(  
        uint256 campaignId  
    ) external;  
}

This is a starting interface, not permission to implement blindly.

The authorization mechanism must be finalized during the contract implementation spike.

---

# **30\. Contract Security Requirements**

The contract must include:

### **Replay protection**

nonce → consumed

### **Expiry**

Authorization cannot be executed after expiry.

### **Campaign binding**

An authorization for campaign A cannot work against campaign B.

### **Recipient binding**

Authorization must commit to recipient.

### **Amount binding**

Authorization must commit to exact amount.

### **Budget protection**

Total rewards cannot exceed funded campaign balance.

### **Access control**

Only authorized actors can:

* create  
* close  
* refund  
* configure operator/authorization settings

### **Emergency controls**

If included, emergency pause must not permit arbitrary withdrawal.

Any emergency mechanism must preserve user/campaign fund safety.

---

# **31\. Reward Authorization**

Recommended conceptual payload:

campaignId  
rewardId  
recipient  
amount  
nonce  
expiry

The backend verifies:

campaign active  
\+  
reward eligible  
\+  
recipient correct  
\+  
amount correct  
\+  
campaign has balance

Then creates authorization.

The exact cryptographic authorization mechanism should be selected during implementation based on the contract architecture and Circle/Arc tooling available at implementation time.

Do not invent a signature scheme in application code without testing it against the contract.

---

# **32\. Wallet Architecture — IMPORTANT**

## **What is NOT locked**

Circle Modular Wallets must **not** be assumed to support Arc mainnet.

The current Circle `use-modular-wallets` skill lists:

Arc mainnet: No  
Arc testnet: Yes

and the transport table only provides an Arc testnet path.

Therefore:

> **Modular Wallets are not an MVP production dependency for Arc mainnet.**

This supersedes the earlier proposal.

---

# **33\. Wallet Abstraction**

The application must define:

WalletProvider

with operations conceptually equivalent to:

getWallet()  
getAddress()  
associateWallet()  
getBalance()

The campaign/reward system must depend on the abstraction rather than Circle-specific wallet APIs.

This protects the product from an infrastructure mismatch.

---

# **34\. Wallet MVP Strategy**

Before implementation begins, run a short **Circle-on-Arc compatibility spike**.

Determine whether Circle's currently supported:

* user-controlled wallets  
* developer-controlled wallets  
* smart contract platform  
* App Kits  
* other Circle wallet infrastructure

can directly perform the required Arc mainnet operations.

Do not infer support merely because Arc is EVM-compatible.

Circle's current wallet documentation differentiates supported account types/chains, so this must be verified against current Circle documentation/MCP before production integration.

---

# **35\. Fallback Wallet Strategy**

If Circle's user-facing wallet infrastructure cannot directly support Arc mainnet at implementation time:

### **MVP fallback**

Allow the participant to associate an existing Arc-compatible wallet address.

The reward system remains:

Telegram identity  
      ↓  
verified action  
      ↓  
Arc address  
      ↓  
USDC reward

This keeps the core product functional without falsely representing Circle wallet support.

The UI should make this explicit:

Connect reward wallet

rather than:

Create Circle wallet

unless Circle support is confirmed.

---

# **36\. Why this is the correct separation**

The product's essential innovation is:

Telegram verification  
\+  
programmable rewards  
\+  
Arc settlement

not:

another embedded wallet.

Wallet infrastructure should therefore remain replaceable.

---

# **37\. Circle Integration**

Circle remains an important integration target.

Use Circle documentation/Skills/MCP as the authoritative source for:

* current wallet capabilities  
* Arc compatibility  
* SDK versions  
* contract tooling  
* USDC handling  
* transaction APIs  
* supported chains  
* current addresses

Circle's Skills repository explicitly provides dedicated skills for Arc, USDC, wallets, developer-controlled wallets, user-controlled wallets, modular wallets and smart-contract tooling.

Circle's MCP should be consulted for implementation details that may change over time.

---

# **38\. Arc Studio**

Arc Studio is a development accelerator.

It may be used to:

* prototype contract logic  
* generate initial Solidity  
* experiment with frontend/backend flows  
* inspect transactions  
* trace on-chain interactions

But generated code must be independently reviewed.

The production application must not depend on Studio being available at runtime.

Arc describes Studio as an onchain coding agent capable of generating application and smart-contract infrastructure and deploying to Arc.

---

# **39\. App Kits**

The MVP should only use App Kit functionality where it directly reduces implementation complexity.

Potential future/optional integration:

Onramp

for campaign creators who need to acquire USDC.

Do not implement:

* Swap  
* Bridge  
* Earn  
* Borrow  
* Lending

for MVP.

Arc's App Kits are intended to abstract common stablecoin operations such as send, bridge and swap, while remaining compatible with Circle or third-party wallet infrastructure.

---

# **40\. Campaign Creator Funding**

Preferred flow:

Create campaign  
       ↓  
Campaign DRAFT  
       ↓  
Connect funding wallet  
       ↓  
Approve USDC  
       ↓  
Fund CampaignEscrow  
       ↓  
Verify funding  
       ↓  
Campaign ACTIVE

Do not mark a campaign funded merely because a transaction was submitted.

Only:

on-chain confirmation

changes the campaign to funded.

---

# **41\. Campaign Funding State Machine**

DRAFT  
  ↓  
FUNDING  
  ↓  
FUNDED  
  ↓  
ACTIVE

Failures:

FUNDING  
   ↓  
FUNDING\_FAILED  
   ↓  
DRAFT

---

# **42\. Campaign Launch Requirements**

Before `ACTIVE`:

creator exists  
target chat exists  
bot is administrator  
reward \> 0  
referral reward \>= 0  
budget \> 0  
wallet/funding source valid  
funding confirmed  
campaign configuration immutable

---

# **43\. User Journey**

## **First visit**

Telegram  
  ↓  
Campaign link  
  ↓  
Mini App  
  ↓  
Authenticate  
  ↓  
Campaign screen

Campaign screen:

Earn \$0.10 USDC

Join:  
@examplechannel

Reward:  
\$0.10

Referral:  
\$0.05

\[Join Channel\]  
\[Verify\]

---

# **44\. User Verification Flow**

User clicks Verify  
        ↓  
Backend receives request  
        ↓  
Authenticate session  
        ↓  
Load campaign  
        ↓  
Check campaign ACTIVE  
        ↓  
Check user has not already completed  
        ↓  
getChatMember()  
        ↓  
Evaluate membership  
        ↓  
Create USER\_COMPLETION reward  
        ↓  
Create REFERRAL reward if applicable  
        ↓  
Settlement

---

# **45\. Anti-Abuse MVP**

No ML.

Implement deterministic protections:

### **One completion per campaign**

UNIQUE(campaign\_id, user\_id)

### **One referrer**

UNIQUE(campaign\_id, referred\_user\_id)

### **No self-referral**

referrer\_user\_id \!= referred\_user\_id

### **Campaign budget limit**

Never pay beyond available campaign funds.

### **Immutable reward**

Once approved, reward amount cannot be changed.

### **Telegram identity**

Only validated Telegram identity can participate.

### **Membership**

Reward only after current membership verification.

### **Rate limiting**

Limit:

verification attempts / user / campaign

### **Idempotency**

Repeated requests must return the existing result rather than create another reward.

---

# **46\. Do NOT implement account-age heuristics in MVP**

Do not initially use:

Telegram account age  
username age  
Premium status  
profile photo

as eligibility criteria.

These add complexity without being necessary to demonstrate the core mechanism.

---

# **47\. Database**

Recommended initial relational schema:

users  
campaigns  
tasks  
participations  
referrals  
rewards  
ledger\_entries  
wallet\_associations  
blockchain\_transactions  
campaign\_events

---

# **48\. Database Constraints**

Critical uniqueness:

users.telegram\_user\_id UNIQUE

campaigns.public\_id UNIQUE

participations(campaign\_id, user\_id) UNIQUE

referrals(campaign\_id, referred\_user\_id) UNIQUE

rewards.reward\_id UNIQUE

rewards.authorization\_nonce UNIQUE

blockchain\_transactions.tx\_hash UNIQUE

---

# **49\. Blockchain Transaction Model**

BlockchainTransaction  
├── id  
├── reward\_id  
├── campaign\_id  
├── chain\_id  
├── tx\_hash  
├── transaction\_type  
├── status  
├── submitted\_at  
├── confirmed\_at  
├── block\_number  
├── error\_code  
├── error\_message  
└── created\_at

Transaction types:

CAMPAIGN\_CREATE  
CAMPAIGN\_FUND  
REWARD\_PAYOUT  
CAMPAIGN\_REFUND

---

# **50\. Reconciliation Worker**

A background job periodically checks:

database reward state  
        ↕  
Arc transaction  
        ↕  
Campaign contract events

If a discrepancy exists:

RECONCILIATION\_ALERT

must be generated.

Never silently overwrite the database to make it match an assumption.

---

# **51\. Contract Events**

At minimum:

CampaignCreated(  
    uint256 indexed campaignId  
)

CampaignFunded(  
    uint256 indexed campaignId,  
    address indexed funder,  
    uint256 amount  
)

RewardPaid(  
    uint256 indexed campaignId,  
    uint256 indexed rewardId,  
    address indexed recipient,  
    uint256 amount  
)

CampaignClosed(  
    uint256 indexed campaignId  
)

CampaignRefunded(  
    uint256 indexed campaignId,  
    address indexed recipient,  
    uint256 amount  
)

---

# **52\. API**

## **Authentication**

POST /api/auth/telegram  
GET  /api/me

## **Campaigns**

POST /api/campaigns  
GET  /api/campaigns/:id  
POST /api/campaigns/:id/fund  
POST /api/campaigns/:id/activate  
POST /api/campaigns/:id/pause  
POST /api/campaigns/:id/close

## **Participation**

POST /api/campaigns/:id/join  
POST /api/campaigns/:id/verify  
GET  /api/campaigns/:id/status

## **Referral**

GET /api/campaigns/:id/referral

## **Rewards**

GET /api/rewards  
GET /api/rewards/:id

---

# **53\. API Security**

Never trust client-supplied:

user\_id  
telegram\_user\_id  
reward\_amount  
reward\_status  
referrer\_user\_id  
campaign\_creator\_id  
wallet ownership

These are server-derived or server-authorized values.

---

# **54\. Authentication Session**

After Telegram validation:

Telegram initData  
      ↓  
Backend validation  
      ↓  
Application session

Do not repeatedly pass raw Telegram identity fields as authorization.

Use a normal secure server session/JWT architecture.

---

# **55\. Campaign Creator Authorization**

Creator endpoints must verify:

authenticated user  
\+  
campaign.creator\_id \== authenticated user.id

Never rely on:

---

# **56\. Reward Worker**

Use a durable asynchronous worker.

Conceptually:

reward status \= AUTHORIZED  
       ↓  
Settlement Worker  
       ↓  
submit transaction  
       ↓  
store transaction ID/hash  
       ↓  
poll/receive confirmation  
       ↓  
mark PAID

Retries must be idempotent.

---

# **57\. Failure Handling**

## **Telegram unavailable**

Reward remains:

PENDING\_VERIFICATION

Retry later.

---

## **Blockchain RPC unavailable**

Reward remains:

AUTHORIZED

and is retried.

---

## **Transaction fails**

Reward becomes:

FAILED

with reason.

Do not automatically create a second reward.

---

## **Duplicate verification request**

Return existing participation/reward.

Never create another payout.

---

# **58\. Security Boundaries**

## **Telegram**

Protect:

* bot token  
* initData validation  
* webhook credentials

---

## **Application**

Protect:

* database  
* session secrets  
* Circle API credentials  
* blockchain signing credentials  
* reward authorization mechanism

---

## **Blockchain**

Protect:

* escrow contract  
* authorization signer/operator  
* campaign balances

---

# **59\. Secrets**

Never commit:

BOT\_TOKEN  
CIRCLE\_API\_KEY  
ENTITY\_SECRET  
PRIVATE\_KEY  
CLIENT\_KEY  
DATABASE\_PASSWORD  
SESSION\_SECRET

Use environment variables/secrets management.

Circle's wallet skills explicitly prohibit committing or logging wallet/API secrets.

---

# **60\. Testnet First**

All development and contract testing must use:

Arc Testnet

before mainnet.

Arc's current Circle skill explicitly recommends defaulting to testnet and treating mainnet transactions as irreversible.

Mainnet deployment requires explicit confirmation.

---

# **61\. Test Strategy**

## **Unit tests**

### **Campaign**

* creation  
* activation  
* pause  
* close  
* budget limits

### **Referral**

* attribution  
* duplicate prevention  
* self-referral  
* one-referrer rule

### **Rewards**

* eligibility  
* duplicate prevention  
* amount calculation  
* state transitions

### **Telegram**

* valid initData  
* invalid signature  
* expired auth\_date  
* membership states

### **Ledger**

* funding  
* reward  
* referral  
* refund  
* balance invariant

---

# **62\. Smart Contract Tests**

Must test:

create campaign  
fund campaign  
valid reward  
invalid signature  
wrong campaign  
wrong recipient  
wrong amount  
expired authorization  
replayed authorization  
over-budget reward  
close campaign  
refund

Also fuzz:

amount  
nonce  
campaign ID  
reward ID  
expiry  
recipient

---

# **63\. End-to-End Test**

A single automated happy-path test should perform:

Create campaign  
      ↓  
Fund campaign  
      ↓  
Launch  
      ↓  
Create participant  
      ↓  
Open referral link  
      ↓  
Verify Telegram identity  
      ↓  
Mock/real membership verification  
      ↓  
Create reward  
      ↓  
Submit Arc transaction  
      ↓  
Confirm transaction  
      ↓  
Verify user received USDC  
      ↓  
Verify ledger  
      ↓  
Verify campaign balance

Then repeat with:

referred user

and verify both rewards.

---

# **64\. Acceptance Criteria**

The MVP is complete only when all of the following are true.

### **A. Campaign creation**

A creator can create a campaign with:

target Telegram channel  
user reward  
referral reward  
budget

---

### **B. Funding**

The campaign can receive real USDC on Arc.

---

### **C. Telegram**

A user can open the campaign directly from Telegram.

---

### **D. Authentication**

Backend validates the Telegram Mini App session.

---

### **E. Verification**

The system verifies actual target-channel membership.

---

### **F. Reward**

Successful verification creates exactly one user reward.

---

### **G. Referral**

A referred participant can generate:

user reward  
\+  
referrer reward

exactly once.

---

### **H. Settlement**

At least one reward is actually settled on Arc.

---

### **I. Accounting**

Dashboard and internal ledger agree with the on-chain campaign balance.

---

### **J. Failure safety**

Retrying verification or settlement cannot create duplicate payouts.

---

# **65\. Demo Scenario**

Campaign:

Campaign:  
Grow Demo Channel

Budget:  
25 USDC

User reward:  
0.10 USDC

Referral reward:  
0.05 USDC

Maximum participants:  
100

Flow:

Creator  
  ↓  
funds 25 USDC  
  ↓  
launches campaign

Alice:

opens campaign  
  ↓  
joins @DemoChannel  
  ↓  
verifies  
  ↓  
receives 0.10 USDC

Alice shares:

campaign referral link

Bob:

opens link  
  ↓  
joins channel  
  ↓  
verifies  
  ↓  
receives 0.10 USDC

Alice:

receives 0.05 USDC referral reward

Dashboard:

Funded:             \$25.00  
Participants:            2  
User rewards:          \$0.20  
Referral rewards:      \$0.05  
Remaining:            \$24.75

The demo should show the corresponding Arc transactions.

---

# **66\. Product UX**

## **Participant home**

Earn USDC

Join the community.  
Get rewarded.

\[View Campaign\]

---

## **Campaign**

Grow with Example

Join @ExampleChannel

Reward  
\$0.10 USDC

Invite friends  
Earn \$0.05 USDC each

\[Join Channel\]  
\[Verify\]

---

## **Completed**

✓ Verified

You earned:

\$0.10 USDC

\[Invite Friends\]

---

## **Referral**

Your referral reward

\$0.05 USDC

Share this campaign:

\[Share on Telegram\]

Telegram Mini Apps support native sharing functionality, including sharing content back into Telegram chats, which can later make the referral UX more native.

---

# **67\. Campaign Creator Dashboard**

Campaign  
Grow Example Channel

Status  
ACTIVE

Budget  
\$25.00

Spent  
\$0.25

Remaining  
\$24.75

Participants  
2

Verified  
2

User rewards  
\$0.20

Referral rewards  
\$0.05

Each financial number should be traceable to ledger entries and/or on-chain events.

---

# **68\. Future Architecture**

The MVP intentionally establishes extension points.

Later:

TaskVerifier  
├── TelegramMembership  
├── TelegramReaction  
├── TelegramComment  
├── Quiz  
├── Survey  
├── Purchase  
├── Retention  
└── Webhook

Reward types:

USER\_COMPLETION  
REFERRAL  
CREATOR\_COMMISSION  
INFLUENCER\_COMMISSION

Campaign distribution:

Direct  
Influencer  
Telegram Channel  
Partner  
Affiliate

But none are implemented in MVP.

---

# **69\. Future Performance Marketing Model**

Eventually:

Advertiser  
     ↓  
Campaign  
     ↓  
Distribution Partner  
     ↓  
Telegram Audience  
     ↓  
User  
     ↓  
Verified Acquisition  
     ↓  
USDC

This turns the product into a performance-based Telegram advertising network.

That is the long-term commercial model.

The MVP only proves the underlying mechanism.

---

# **70\. Recommended Repository Structure**

/apps  
  /web  
  /telegram-mini-app  
  /api

/packages  
  /domain  
  /telegram  
  /wallet  
  /arc  
  /rewards  
  /ledger

/contracts  
  CampaignEscrow.sol  
  /script  
  /test

/worker  
  settlement  
  reconciliation

/docs  
  PRD.md  
  ARCHITECTURE.md  
  SECURITY.md  
  CONTRACT.md

Exact framework choices should be decided after repository inspection rather than prescribed blindly.

---

# **71\. Implementation Order**

## **Phase 0 — Integration Spike**

Before significant implementation:

1. Verify Circle's current Arc mainnet wallet support.  
2. Verify Circle API/SDK ability to create or associate wallets usable on Arc.  
3. Verify USDC transfer support.  
4. Verify whether Circle can submit Arc mainnet contract transactions.  
5. Verify current Circle MCP responses.  
6. Verify Arc contract deployment path.  
7. Verify Telegram Mini App authentication.  
8. Verify Telegram membership lookup.

This phase should produce a written compatibility matrix.

---

# **72\. Phase 1 — Foundation**

Implement:

project  
database  
migrations  
config  
authentication  
campaign model  
user model

No blockchain money movement yet.

---

# **73\. Phase 2 — Telegram**

Implement:

Mini App  
Bot  
initData validation  
campaign startapp parsing  
membership verifier

Demonstrate:

Telegram → Backend → verified user

---

# **74\. Phase 3 — Campaign Engine**

Implement:

campaign lifecycle  
task  
participation  
referral  
eligibility  
reward records

Use mocked settlement.

Demonstrate:

user completes task  
→ reward becomes eligible

---

# **75\. Phase 4 — Contract**

Implement:

CampaignEscrow

Then:

Foundry tests  
fuzz tests  
deployment script  
testnet deployment

---

# **76\. Phase 5 — Arc Settlement**

Connect:

Reward Engine  
       ↓  
Authorization  
       ↓  
CampaignEscrow  
       ↓  
Arc Testnet

Then:

reconciliation

---

# **77\. Phase 6 — Wallet**

Implement the wallet provider selected by the Phase 0 compatibility spike.

The rest of the application must not change depending on the selected wallet provider.

---

# **78\. Phase 7 — Real Demo**

Use:

Arc Testnet

first.

Run:

creator  
→ campaign  
→ funding  
→ Telegram user  
→ membership  
→ reward  
→ referral  
→ reward

Then perform controlled mainnet deployment.

---

# **79\. Phase 8 — Bounty Polish**

Only after the complete flow works:

* polished Mini App  
* campaign dashboard  
* transaction links  
* clear USDC balances  
* visual reward history  
* referral sharing  
* error states  
* demo campaign  
* architecture diagram  
* short demo video  
* README  
* deployment instructions

---

# **80\. Engineering Rules for OpenCode**

OpenCode must:

1. Inspect the repository before modifying anything.  
2. Inspect existing infrastructure before selecting libraries.  
3. Read the relevant Circle Skills before implementing Circle functionality.  
4. Use Circle MCP for current SDK/API details.  
5. Never assume Arc compatibility from generic EVM compatibility.  
6. Never hardcode secrets.  
7. Never implement mainnet transactions before testnet validation.  
8. Never modify financial state without idempotency.  
9. Never treat submitted transactions as confirmed.  
10. Never use floating-point money.  
11. Never trust Telegram `initDataUnsafe`.  
12. Never accept client-provided reward amounts as authoritative.  
13. Never put Telegram-specific logic into the smart contract.  
14. Never introduce additional MVP features without explicit approval.  
15. Prefer deterministic logic over heuristic/AI logic.

---

# **81\. Definition of Done**

The project is MVP-complete when:

\[✓\] Telegram Mini App launches  
\[✓\] Telegram identity is cryptographically validated  
\[✓\] Campaign exists  
\[✓\] Campaign creator funds campaign  
\[✓\] Campaign exists on Arc  
\[✓\] User joins target Telegram channel  
\[✓\] Bot verifies membership  
\[✓\] User becomes eligible  
\[✓\] Reward is created  
\[✓\] Reward is settled on Arc  
\[✓\] Referral is attributed  
\[✓\] Referral reward is created  
\[✓\] Referral reward is settled  
\[✓\] Duplicate verification cannot duplicate payout  
\[✓\] Duplicate settlement cannot duplicate payout  
\[✓\] Ledger reconciles  
\[✓\] Campaign balance reconciles  
\[✓\] Testnet E2E passes  
\[✓\] Mainnet E2E passes with controlled funds  
\[✓\] Demo is reproducible from README

---

# **82\. Non-Goals That Must Stay Non-Goals**

If implementation starts drifting toward:

"Let's add influencers"  
"Let's add a marketplace"  
"Let's add more task types"  
"Let's build fraud scoring"  
"Let's support Base"  
"Let's add a token"  
"Let's build a wallet ourselves"

stop.

The MVP's purpose is to prove:

> **A real-world Telegram action can deterministically trigger a programmable USDC payment on Arc.**

Everything else is secondary.

---

# **83\. Final System Statement**

The system should ultimately be explainable in one sentence:

> **Campaign creators deposit USDC into an Arc campaign escrow, Telegram users complete verified actions, and the platform automatically settles predefined rewards to eligible participants and referrers.**

The technology mapping is:

Telegram  
    \= identity \+ distribution \+ verification

Backend  
    \= campaign \+ eligibility \+ reward logic

CampaignEscrow  
    \= financial enforcement

Arc  
    \= settlement

USDC  
    \= campaign budget \+ reward asset

Circle  
    \= wallet/payment/infrastructure integration where  
      currently supported

The wallet implementation remains an adapter until the Phase 0 Circle-on-Arc compatibility test is completed.

That is intentional.

It prevents us from making the same mistake as the earlier Modular Wallet assumption while keeping the architecture ready to use Circle wherever the current product actually supports the required Arc mainnet flow.

