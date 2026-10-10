# S0-4 — Dropped-Transaction Detection Window

**Result:** ✅ GO

## Observed behavior (Arc testnet, 2026-10-10)

Current fee conditions: `base_fee = 20 gwei`, `gas_price = 25 gwei`. The 20 Gwei floor **is** the base-fee minimum.

### Submission below floor
- Sending with `maxFeePerGas = 10 gwei`:
  - **If the gas limit is auto-estimated**, the node rejects up front: `-32000: max fee per gas less than block base fee`.
  - **If the gas limit is supplied** (`--gas-limit 21000`), the tx is **accepted into the mempool** and then **silently dropped**: it sat pending for **~64s**, then was evicted (`eth_getTransactionByHash → null`) with **`eth_getTransactionReceipt → null`** — no error, no revert receipt.

### At/above floor
- Control tx at `30 gwei` (priority 2 gwei) mined in **1s**, `status 0x1` — consistent with Arc's sub-second deterministic finality.

## Detection rule (recommended)

1. **Never** submit `maxFeePerGas < 20 gwei`. Set `maxFeePerGas = max(20 gwei, 2 × baseFee)` (base fee is in the parent header's `extra_data`).
2. On submission, record the tx hash + nonce.
3. Poll every ~5s:
   - `eth_getTransactionReceipt` non-null → mined (act immediately; 1 confirmation is final).
   - `eth_getTransactionByHash → null` while `eth_getTransactionByHash` was previously non-null → **evicted/dropped** → rebroadcast with corrected fees.
   - `pending nonce > latest nonce` for too long → a stuck predecessor is blocking the account.
4. Use a conservative **30s** pre-rebroadcast window (observed eviction was ~64s, but 30s avoids long stalls); treat mempool eviction as the definitive drop signal.

## Impact on the plan
- `blockchain_transactions` bookkeeping must store `submittedAt`, `lastObservedHash`, `status`, and a `detectionWindow` so the worker can distinguish SUBMITTED-but-dropped from SUBMITTED-and-mined. Prevents blind re-sends.

## Repro
```bash
set -a && . spikes/s02-escrow-deploy/.env && set +a
RPC=$RPC_URL PK=$SPIKE_PK bash spikes/s04-drop-window/measure.sh
```
