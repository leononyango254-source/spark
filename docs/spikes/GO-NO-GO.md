# Phase 0 Gate — GO / NO-GO

**Date:** 2026-10-10
**Branch:** `phase-0-spikes`
**Overall verdict:** ✅ **GO** — all spikes resolved. Cleared to start `TASK-002` (monorepo scaffold) when you're ready.

---

## Scoreboard

| Spike | Result | Key evidence |
|---|---|---|
| S0-1 Arc network smoke | ✅ GO | chain IDs `5042` / `5042002`, USDC 6dp, RPCs live |
| S0-2 Contract deployability | ✅ GO | `cancun` deployed to `0xfd4d…Eb4a`; live create→fund→pay→close round-trip balanced |
| S0-3 Circle DCW contract call | ⏭️ WAIVED | superseded by viem EOA operator (mainnet requires it anyway) |
| S0-4 Dropped-tx window | ✅ GO | sub-floor tx accepted then evicted at ~64s, no receipt; `≥20 gwei` mined in 1s |
| S0-5 Dual-emitter reconciliation | ✅ GO | livelog: `system_18dp == usdc_6dp × 1e12` confirmed |
| S0-6 Telegram initData | ✅ GO | 9/9 tests (HMAC, freshness, membership) |
| S0-7 Circle mainnet + Onramp | ✅ GO | mainnet contract exec unsupported → viem; Onramp spike-only |

Evidence: `docs/spikes/S0-1-network.md`, `S0-2-deploy.md`, `S0-3-circle-dcw.md`, `S0-4-drop-window.md`, `S0-5-reconcile.md`, `S0-6-telegram.md`, `S0-7-circle-onramp.md`.

---

## Decisions locked by Phase 0

1. **Operator path = viem EOA** behind `WalletProvider`. Circle wallets cannot submit Arc mainnet contract calls; the viem path is mandatory for mainnet and is the only operator we build now.
2. **Contract EVM target = `cancun`** (Arc's documented baseline is `Osaka`; cancun proven forward-compatible via live deploy). Keep `paris` + OZ 4.9.6 as a documented fallback only.
3. **Reconciliation**: filter by emitter; **never sum** the ERC-20 `0x3600…` (6dp) and system `0xffff…fffe` (18dp) logs. Order by block number + log index (timestamps non-decreasing). Credit using native 18dp; ERC-20 `balanceOf` truncates sub-USDC fractions.
4. **Fees**: `maxFeePerGas ≥ max(20 gwei, 2×baseFee)`. Sub-floor txs are silently dropped after ~60s — poll and rebroadcast on mempool eviction.
5. **Finality**: act on 1 confirmation (sub-second).
6. **Onramp**: viable (US/UK/EU, non-custodial, sandbox `onramp-sandbox.arc.io`) but **out of MVP scope**.
7. **Testnet-first**, then controlled mainnet (PRD §60). Mainnet deployment still requires explicit confirmation.

## Residual risks (carried into implementation)
- Local `anvil` can't reproduce Arc semantics; CI must run Arc-testnet integration steps (or `arc-forge`) for USDC/value-transfer paths.
- Live `getChatMember` + bot-admin setup not yet exercised (needs a bot token) — deterministic validator is verified.
- Arc blocklist prevalidation not empirically tested (test address available: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).

## Gate rule → next
All gate criteria met. **Proceed to `TASK-002`**: monorepo/toolchain scaffold + move `Spark prd.md` → `docs/PRD.md`.
