# S0-1 — Arc Network Smoke Test

**Result:** ✅ GO

## Evidence (captured 2026-10-10)

| Property | Testnet | Mainnet | Expected (PRD) | Status |
|---|---|---|---|---|
| `eth_chainId` | `5042002` | `5042` | 5042002 / 5042 | ✅ |
| latest block | 66524798 | 25288833 | advancing | ✅ |
| USDC `decimals()` | 6 | 6 | 6 | ✅ |
| USDC `symbol()` | `USDC` | n/a | USDC | ✅ |
| USDC code size | 1798 bytes | present | deployed | ✅ |
| `eth_gasPrice` | 25 Gwei | — | ≥ 20 Gwei floor | ✅ |

- RPC endpoints reachable: `https://rpc.testnet.arc.io`, `https://rpc.mainnet.arc.io`.
- USDC contract `0x3600000000000000000000000000000000000000` is live on both networks.
- Observed gas price (25 Gwei) is above the documented 20 Gwei minimum `maxFeePerGas`; sub-floor drop behavior tested separately in S0-4.

## Conclusion

Arc network parameters match the PRD exactly. Toolchain (`cast`) reads both networks without issue. No blockers.

## Repro

```bash
bash spikes/s01-network/check.sh
```
