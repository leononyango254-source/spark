# CampaignEscrow (Foundry)

Seeded from the Phase 0 spike that deployed and ran end-to-end on Arc testnet. This is a
starting point, **not** the hardened Phase 4 implementation. See [`../docs/CONTRACT.md`](../docs/CONTRACT.md).

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
