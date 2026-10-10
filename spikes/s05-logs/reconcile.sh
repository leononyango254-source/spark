#!/usr/bin/env bash
# Observes real USDC movements on Arc and checks the dual-emitter log rule.
# Read-only: no funds required.
set -euo pipefail

RPC=${RPC:-https://rpc.testnet.arc.io}
USDC=$(echo "0x3600000000000000000000000000000000000000" | tr 'A-Z' 'a-z')
SYS=$(echo "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE" | tr 'A-Z' 'a-z')
TRANSFER=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
WINDOW=${WINDOW:-50}
SCAN=${SCAN:-25}

LATEST=$(cast block-number --rpc-url "$RPC")
FROM=$((LATEST - WINDOW))
echo "rpc=$RPC range=$FROM..$LATEST"

TXS=$(cast logs --from-block "$FROM" --to-block "$LATEST" --address "$USDC" "$TRANSFER" \
  --rpc-url "$RPC" --json | jq -r '.[].transactionHash' | awk '!seen[$0]++' | head -n "$SCAN")

found=0
for TX in $TXS; do
  REC=$(cast receipt "$TX" --rpc-url "$RPC" --json)
  USDC_DATA=$(echo "$REC" | jq -c --arg U "$USDC" --arg T "$TRANSFER" '[.logs[] | select(.topics[0]==$T) | select((.address|ascii_downcase)==$U) | .data]')
  SYS_DATA=$(echo "$REC" | jq -c --arg S "$SYS" --arg T "$TRANSFER" '[.logs[] | select(.topics[0]==$T) | select((.address|ascii_downcase)==$S) | .data]')
  if [ "$SYS_DATA" = "[]" ] || [ "$USDC_DATA" = "[]" ]; then
    continue
  fi
  RESULT=$(node -e '
    const usdcList = JSON.parse(process.argv[1] || "[]");
    const sysList  = JSON.parse(process.argv[2] || "[]");
    const u = usdcList.map(BigInt), s = sysList.map(BigInt);
    let matched = 0;
    for (const a of u) for (const b of s) if (b === a * 1000000000000n) matched++;
    console.log(JSON.stringify({
      usdc_6dp_values: u.map(String),
      system_18dp_values: s.map(String),
      matched_pairs: matched,
      verdict: matched > 0 ? "CONFIRMED dual-emitter 1e12 relationship" : "no match in tx"
    }));
  ' "$USDC_DATA" "$SYS_DATA")
  if [ "$(echo "$RESULT" | jq -r '.matched_pairs')" -gt 0 ]; then
    echo "sample_tx=$TX"
    echo "$RESULT" | jq .
    found=1
    break
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No tx with matching dual-emitter pair found in sampled window."
  echo "Increase WINDOW/SCAN or use a known USDC transfer tx."
fi
