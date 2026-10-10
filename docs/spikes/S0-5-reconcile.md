# S0-5 — USDC Dual-`Transfer` Log Reconciliation

**Result:** ✅ GO (read-only, no funding required)

## What happens

A single native USDC movement on Arc emits **two `Transfer` logs** (`topic0 = 0xddf252ad…b3ef`), from **two different emitters**:

| Emitter | Decimals | Meaning |
|---|---|---|
| `0x3600000000000000000000000000000000000000` | **6** | USDC ERC-20 interface event |
| `0xfffffffFfFFFff…FFFE` (system emitter) | **18** | EIP-7708 native value movement |

## Empirical proof (Arc testnet, 2026-10-10)

`spikes/s05-logs/reconcile.sh` scanned recent blocks and matched a real tx:

```
sample_tx = 0xc9f7796e14297410e56242d6ab5b8ea54d5c010d6df3e65cd322c7014286630d
usdc_erc20_6dp  = 1079950
system_emitter_18dp = 1079950000000000000
matched_pairs (sys == usdc*1e12) = 1
VERDICT: CONFIRMED dual-emitter 1e12 relationship
```

Also observed an earlier tx `0x9e47acc0…` containing a USDC move plus an **EURC** move (emitter `0x89b50855…`), confirming each token has its own emitter and the system emitter tracks the **native (USDC) 18-decimal** movement only.

Note: a `Transfer` event with value `0` (e.g., a contract emitting a zero-value transfer) does **not** produce a matching system-emitter log — so pair on **value**, not merely presence.

## Reconciliation rule (authoritative)

1. Filter `Transfer` logs by **emitter address**:
   - Use `0x3600000000000000000000000000000000000000` for **6-decimal accounting** (authoritative for USDC amounts); OR
   - Use the system emitter `0xffff…fffe` and divide by `1e12`.
2. **Never sum both emitters** — that double-counts every movement (Arc docs: "avoiding double-counting from two emitter addresses").
3. Balance caveat: the **native** balance is 18-decimal; the ERC-20 `balanceOf` **truncates** sub-USDC fractions. A zero `balanceOf` does not mean zero native balance. Credit/reconcile using the native 18-decimal value.
4. Gas: derive fee from the receipt; gas deductions emit **no** log.
5. Ordering: block timestamps are **non-decreasing** (not strictly increasing) → order by **block number + log index**, never by timestamp.

## Impact on the plan
- The earlier assumption "filter emitter = `0x3600…0000`" is **correct but incomplete** — must also explicitly ignore/convert the system emitter to avoid double-counting.
- `docs/spikes/GO-NO-GO.md` records this as a contract/reconciliation requirement for `TASK-002`+.

## Repro
```bash
bash spikes/s05-logs/reconcile.sh
```
