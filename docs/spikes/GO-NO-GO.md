# Phase 0 Gate — GO / NO-GO

**Date:** 2026-10-10
**Branch:** `phase-0-spikes`
**Overall verdict:** 🟡 **CONDITIONAL GO** — all architecture/code risks resolved or have confirmed fallbacks; two empirical spikes remain, blocked only on external inputs (testnet funding + Circle credentials).

---

## Scoreboard

| Spike | Result | Evidence |
|---|---|---|
| S0-1 Arc network smoke | ✅ GO | Both chain IDs (5042 / 5042002), USDC 6dp, RPCs live — `S0-1-network.md` |
| S0-2 Contract deployability | 🟡 PARTIAL | `cancun` compiles + 3 local tests pass; **testnet deploy blocked on funding** — `S0-2-deploy.md` |
| S0-3 Circle DCW contract call | ⏳ BLOCKED | Needs Circle API key + entity secret — `S0-3` |
| S0-4 Dropped-tx window | ⏳ BLOCKED | Needs funded account — `S0-4` |
| S0-5 Dual-emitter reconciliation | ✅ GO | Confirmed live: `sys18 == usdc6 × 1e12` — `S0-5-reconcile.md` |
| S0-6 Telegram initData | ✅ GO | 9/9 tests pass (HMAC, freshness, membership) — `S0-6-telegram.md` |
| S0-7 Circle mainnet + Onramp | ✅ GO | Mainnet contract exec = **not supported**; Onramp = spike only — `S0-7-circle-onramp.md` |

---

## Decisions locked by Phase 0

1. **Mainnet operator = viem EOA**, not Circle DCW. Circle wallet contract execution is documented for **Arc Testnet (`ARC-TESTNET`) only**; Arc mainnet falls under generic `EVM` where *contract execution is not supported*. (`WalletProvider` fallback from PRD line ~1054 is now the **primary** mainnet path.)
2. **Testnet operator** may use Circle DCW (`ARC-TESTNET`, EOA/SCA/MSCA supported) — pending S0-3 live confirmation.
3. **Reconciliation must filter by emitter and never sum** the ERC-20 `0x3600…` (6dp) and system `0xffff…fffe` (18dp) logs. Order by block number + log index (timestamps non-decreasing).
4. **Gas: `maxFeePerGas` ≥ 20 Gwei** or the tx is silently dropped (no receipt).
5. **Local `anvil` cannot validate Arc semantics** — final validation requires testnet (and possibly `arc-forge`).
6. **Onramp**: viable (US/UK/EU, non-custodial, sandbox exists) but **out of MVP scope** (spike only).
7. **Arc mainnet is live** (`5042`), despite Circle's stale `use-arc` skill claiming "testnet only."

---

## Remaining to close the gate

### Need from you
1. **Fund** `0x6c8699A8f1D6cE214331261e6B6d2d8abe749717` on Arc Testnet (https://faucet.circle.com → Arc Testnet). Unblocks **S0-2** (deploy) and **S0-4** (drop window) and **S0-5 hardening** (on-chain payReward round-trip).
2. **Circle credentials** (API key + entity secret + wallet set) to run **S0-3**, *or* confirm we skip it and adopt the viem fallback as the tested path (mainnet already requires viem anyway).

### Optional
3. Telegram **bot token** to validate live `getChatMember` (S0-6 step 3). Deterministic validator already passes.

---

## Gate rule
- If the S0-2 testnet deploy succeeds and S0-4 yields a usable drop-detection window → **GO** for `TASK-002` (monorepo scaffold).
- If Circle creds are not provided, S0-3 is waived: the viem EOA operator path (which mainnet requires regardless) will be the operator implementation, exercised live once funded.

## Evidence index
`docs/spikes/`: `S0-1-network.md`, `S0-2-deploy.md`, `S0-5-reconcile.md`, `S0-6-telegram.md`, `S0-7-circle-onramp.md`
`spikes/`: `s01-network/`, `s02-escrow-deploy/`, `s05-logs/`, `s06-telegram/`
