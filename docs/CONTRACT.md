# CampaignEscrow Contract Notes

## Status

Production Phase 4 `contracts/src/CampaignEscrow.sol`, **deployed to Arc testnet** at
**`0x9539efAFf246799827E6F5E6Cbc475122710Ef64`** (`cancun` bytecode). Deployer = owner = operator:
`0xfB4d09d7969d0446C45721E44409d9482eEcDCb1`. Constructor: `usdc = 0x3600…0000`,
`maxPayoutPerReward = 10_000_000`, `globalPayoutAllowance = 1_000_000_000`.

The Phase 0 spike (historical, replaced by this production contract) deployed at
`0xfd4d0385971F131Fb6f767fd8b4a072F46c9Eb4a`.

## Invariants

- Funds leave only through `payReward` (operator, capped) or `closeCampaign` (refund to recorded creator).
- `maxPayoutPerReward` / `globalPayoutAllowance` are **owner-settable** (no longer immutable).
- Replay protection is dual-layer: `processedReward[rewardId]` (globally unique rewardId) + `usedNonce[campaignId][nonce]`; nonces may be consumed out-of-order.
- Expiry is enforced per payout via the operator-supplied `deadline` (`block.timestamp <= deadline`); recipient + amount are bound per call.
- Owner/operator split: operator can only `payReward`; owner controls operator, global allowance, pause, budget, close/refund.
- `pause()` blocks `createCampaign` / `fundCampaign` / `payReward` but **not** `closeCampaign` (funds stay recoverable; no emergency withdrawal).
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

## Settlement (Phase 5)

The worker submits `payReward` as the operator EOA. Configure `ESCROW_ADDRESS`
(`0x9539efAFf246799827E6F5E6Cbc475122710Ef64` on Arc testnet) and
`OPERATOR_PRIVATE_KEY` in the worker env. Campaigns must be seeded on-chain first
(`pnpm --filter @spark/worker seed:campaign <campaign-db-uuid> <budget-micro-usdc>`),
which records `campaigns.on_chain_campaign_id`.
