# S0-7 — Circle Arc Mainnet Support + Onramp Feasibility (research only)

**Result:** ✅ GO with a **forced fallback on mainnet** — documented below

Sources (fetched 2026-10-10):
- https://developers.circle.com/wallets/supported-blockchains
- https://developers.circle.com/wallets/account-types
- https://developers.circle.com/wallets/dev-controlled
- https://www.circle.com/blog/calling-smart-contracts-with-circle-wallets
- https://www.arc.io/app-kits
- https://docs.arc.io/app-kit
- https://docs.arc.io/app-kit/references/onramp-hosting-requirements
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md

## Q1 — Does Circle support Arc for wallets?

| Network | Listed as | EOA | SCA | MSCA | **Contract execution** |
|---|---|---|---|---|---|
| Arc **Testnet** | `ARC-TESTNET` | ✅ | ✅ | ✅ | ✅ supported |
| Arc **Mainnet** | *not listed by name* → falls under generic `EVM` | ✅ create/sign | ❌ | ❌ | ❌ **not supported** |

Circle's supported-blockchains doc lists a dedicated, fully-featured **Arc Testnet** row, but **no dedicated Arc Mainnet row**. Arc mainnet therefore maps to the generic `EVM` chain code, whose documented limits are:

> *Other EVM blockchains: Wallet creation and signing are supported. Transfers are supported for developer-controlled wallets only. User-controlled wallets can sign, but you must broadcast the transaction yourself. **Contract execution, accelerate, and cancel are not supported.***

Circle's own contract-execution walkthrough (`createContractExecutionTransaction`) uses `ARC-TESTNET` throughout — a further signal that mainnet contract execution is not currently offered.

**Conclusion:** PRD line 2114/2117 is answered — **Circle developer-controlled wallets cannot submit Arc mainnet contract transactions.** The `WalletProvider` fallback (raw viem operator EOA) is the mainnet operator path. Circle DCW remains usable for **Arc testnet** contract execution (S0-3).

## Q2 — Onramp (Arc / Circle)

- Onramp Kit ships in **App Kits** (`@circle-fin/onramp-kit`) as a **hosted widget + TypeScript SDK**.
- **Non-custodial** — Circle ("CTS") does not hold/custody funds; it routes to third-party KYC/payment providers (**Transak** for cards/Apple Pay/Google Pay; **BVNK**, **Lead Bank** for virtual accounts; **Socure** for identity).
- **Regions at launch: US, UK, and select EU.** Offramp **not available**. **Credit cards not supported**; debit card / Apple Pay / Google Pay and (select US states + EU) bank transfers are.
- Requires a **Circle API key held server-side** + business verification; enabled via card/mobile-wallet. Users 18+ and subject to provider sanctions/geo checks.
- Sandbox vs production:

| Setting | Sandbox | Production |
|---|---|---|
| Widget | `https://onramp-sandbox.arc.io` | `https://onramp.arc.io` |
| API | `https://api-test.circle.com` | `https://api.circle.com` |

- Sandbox: OTP any 6 digits (`000000` fails); KYC accepts any face photo; only `DEPOSIT_SUBMITTED` fires (`DEPOSIT_SETTLED` not emitted in sandbox).
- Flow is compatible with the PRD's non-custodial boundary: server mints a short-lived **session**, client mounts the **iframe widget**, USDC lands directly at the destination Arc wallet. No internal balance is created.

**Decision (per user):** **Spike only — do not build in MVP.** Recorded as a viable future funding path.

## Discrepancy to flag
Circle's `use-arc` skill still states *"NEVER target mainnet — Arc is testnet only."* That is **stale**: `eth_chainId 5042` on `https://rpc.mainnet.arc.io` is live (block ~25.3M, verified in S0-1). Treat the skill's mainnet statement as out of date; use the supported-blockchains table (Q1) as authoritative.

## Verification matrix

| Item | Answer | Confidence |
|---|---|---|
| Arc mainnet chain live | Yes (`5042`) | Empirical (S0-1) |
| Circle wallet on Arc testnet (contract call) | Yes | Docs |
| Circle wallet on Arc mainnet (contract call) | **No** | Docs |
| Mainnet operator path | viem EOA / `WalletProvider` fallback | PRD line ~1054 |
| Onramp availability | US/UK/EU, non-custodial, sandbox exists | Docs |
| Onramp in MVP | No (spike only) | User decision |
