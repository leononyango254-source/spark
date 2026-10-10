# S0-2 — Contract Deployability (`cancun` vs `paris`)

**Result:** 🟡 PARTIAL — compiles + local logic pass; on-chain deploy blocked pending testnet funding

## Evidence

### Compiled (✅)
- Solc `0.8.26`, `evm_version = "cancun"`, optimizer on (200 runs).
- `forge build` → success. `CampaignEscrow` creation bytecode 2853 bytes, deployed 2619 bytes.
- Artifact metadata confirms `evmVersion: cancun`.

### Local logic (✅)
`forge test` → 3 passed, 0 failed:
- `test_CreateFundPayClose` — create → fund → payReward → close, balances reconcile.
- `test_PayoutCapEnforced` — `PayoutTooLarge` on > `maxPayoutMicroUsdc`.
- `test_OnlyOperatorCanPay` — `NotOperator` for non-operator.

### Testnet deploy (⏳ blocked)
- `forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast` reached the broadcast stage.
- Predicted contract address: `0xfd4d0385971F131Fb6f767fd8b4a072F46c9Eb4a`
- Failed with: `error code -32003: insufficient funds for gas * price + value: have 0 want 48443955000000000`.
- Estimated gas price 52.5 Gwei (above the 20 Gwei floor).

**Blocker:** the spike deployer address `0x6c8699A8f1D6cE214331261e6B6d2d8abe749717` has 0 native USDC/gas on Arc testnet.

## Required to finish
Fund `0x6c8699A8f1D6cE214331261e6B6d2d8abe749717` from https://faucet.circle.com (select **Arc Testnet**), then re-run:
```bash
cd spikes/s02-escrow-deploy
set -a && . ./.env && set +a
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$SPIKE_PK"
cast code 0xfd4d0385971F131Fb6f767fd8b4a072F46c9Eb4a --rpc-url https://rpc.testnet.arc.io
```

## Caveats discovered (S0-7 docs)
- Arc targets the **Osaka** EVM baseline. `cancun` (our candidate) is a lower target and should be forward-compatible, but the only authoritative validation is an on-chain deploy.
- Arc docs state a local `anvil` runs *standard* EVM and **cannot reproduce Arc-specific behavior**; Arc recommends `arc-anvil --network arc`. Therefore the local `forge test` (3 passed) validates logic only, **not** Arc runtime semantics.
- Arc ships its own Foundry fork (`arc-forge` / `arc-cast` / `arc-anvil`, https://github.com/circlefin/arc-foundry/releases). Standard `forge` may not handle Arc protocol differences for deploy; installing Arc Foundry is a candidate step if the standard deploy misbehaves post-funding.

## Remaining GO/NO-GO question
If `cancun` bytecode deploys and executes on Arc testnet → **GO** (cancun path confirmed).
If deploy reverts / tx fails on opcode grounds → retry `evm_version = "paris"` + OpenZeppelin 4.9.6, and/or use `arc-forge`.
