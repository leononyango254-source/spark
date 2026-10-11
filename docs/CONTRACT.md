# CampaignEscrow Contract Notes

## Status

`contracts/src/CampaignEscrow.sol` is seeded from the Phase 0 spike skeleton that **deployed and
ran end-to-end on Arc testnet** (`0xfd4d0385971F131Fb6f767fd8b4a072F46c9Eb4a`, `cancun` bytecode).
It is a starting point, **not** the hardened Phase 4 implementation.

## Invariants (target)

- Funds leave only through `payReward` (operator, capped) or `closeCampaign` (refund to recorded creator).
- `maxPayoutMicroUsdc` is immutable; campaign budget only increases.
- `consumedRewardId` / `consumedNonce` prevent replay.
- Deadline enforced; campaign binding; recipient + amount binding.
- Owner/operator split: operator can only `payReward`; owner controls operator, global allowance, pause, budget, close/refund.
- Compromised-operator loss is bounded by `min(globalPayoutAllowance, Σ remaining campaignBalance)`.
- **No** `withdraw` / `sweep` / `rescue` / `SELFDESTRUCT`.

## Build & test

```bash
cd contracts
forge build
forge test
```

`evm_version = "cancun"`; Solidity `0.8.26`. Arc's documented baseline is Osaka; `cancun` was proven
forward-compatible in Phase 0. `paris` + OpenZeppelin 4.9.6 is the documented fallback.

## Arc deployment reminders

- `maxFeePerGas >= max(20 gwei, 2x baseFee)`.
- Testnet first. Mainnet requires explicit confirmation (PRD §60).
