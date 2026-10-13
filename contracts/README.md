# CampaignEscrow (Foundry)

Production Phase 4 `CampaignEscrow` (replay protection, per-payout expiry, budget caps,
pause-without-withdrawal). Deployed to the Arc testnet — see
[`../docs/CONTRACT.md`](../docs/CONTRACT.md) for the deployed address and status.

## Build & test

```bash
forge build
forge test
```

`evm_version = "cancun"`, Solidity `0.8.26`.

## Dependencies

`lib/` is git-ignored (standard for Foundry). Initialize it on a fresh clone:

```bash
forge install foundry-rs/forge-std --no-commit
```
