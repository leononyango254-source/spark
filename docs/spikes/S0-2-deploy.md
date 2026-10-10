# S0-2 — Contract Deployability (`cancun` vs `paris`)

**Result:** ✅ GO — `cancun` deploys and executes end-to-end on Arc testnet

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

### Testnet deploy + live round-trip (✅)
- `forge script … --broadcast` → **ONCHAIN EXECUTION COMPLETE & SUCCESSFUL**.
- Deployed `CampaignEscrow` at **`0xfd4d0385971F131Fb6f767fd8b4a072F46c9Eb4a`** (testnet). `codesize = 2618`.
- Constructor state read back: `usdc = 0x3600…0000`, `maxPayoutMicroUsdc = 1_000_000`, `globalPayoutAllowance = 25_000_000`, `owner = deployer`.
- Live end-to-end (real testnet USDC):
  - `createCampaign` → id 1 (budget 25,000,000)
  - `approve` + `fundCampaign` → campaign balance 25,000,000
  - `payReward(alice, 100_000)` → campaign balance **24,900,000**, `globalPayoutAllowance` **24,900,000**
  - `closeCampaign` → creator refunded 24,900,000
- Deployer consumed only gas; all value reconciles. Gas price estimated 52.5 Gwei (≥ floor).

## Caveats discovered (S0-7 docs)
- Arc targets the **Osaka** EVM baseline. `cancun` (our candidate) is a lower target and should be forward-compatible, but the only authoritative validation is an on-chain deploy.
- Arc docs state a local `anvil` runs *standard* EVM and **cannot reproduce Arc-specific behavior**; Arc recommends `arc-anvil --network arc`. Therefore the local `forge test` (3 passed) validates logic only, **not** Arc runtime semantics.
- Arc ships its own Foundry fork (`arc-forge` / `arc-cast` / `arc-anvil`, https://github.com/circlefin/arc-foundry/releases). Standard `forge` may not handle Arc protocol differences for deploy; installing Arc Foundry is a candidate step if the standard deploy misbehaves post-funding.

## Remaining GO/NO-GO question
**Resolved → GO.** `cancun` bytecode deploys and executes on Arc testnet; the `paris` + OZ 4.9.6 fallback was not needed. (Note: Arc's documented baseline is `Osaka`; `cancun` proved forward-compatible in practice.)
