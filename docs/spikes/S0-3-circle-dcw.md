# S0-3 — Circle Developer-Controlled Wallets (contract call + restart persistence)

**Result:** ⏭️ WAIVED by user decision — superseded by the viem EOA operator path

## Decision
User elected to **skip S0-3** and adopt a **viem EOA** (`WalletProvider`) as the operator. This is consistent with S0-7: Circle wallets **cannot submit Arc mainnet contract calls** (mainnet = generic `EVM`, contract execution unsupported), so a viem operator is required for mainnet regardless. Building a testnet-only Circle DCW path would add a seam we'd discard before mainnet.

## What this defers
- Circle DCW (developer-controlled wallet) integration is **not** an MVP dependency.
- `WalletProvider` remains the single operator abstraction; the viem implementation is the only one built now.
- If a future need for Circle-managed wallets arises (e.g., testnet tooling), it can be added behind the same `WalletProvider` interface without reworking the reward pipeline.

## Residual risk
- Low. The mainnet operator path was always going to be self-managed EOA signing; S0-2/S0-5/S0-4 already exercise live signing + broadcasting with a viem-compatible key (`cast`) against Arc.
