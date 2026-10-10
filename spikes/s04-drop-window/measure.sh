#!/usr/bin/env bash
# S0-4: measures Arc's sub-floor transaction drop behavior and normal mining latency.
# Requires a funded key in ../../s02-escrow-deploy/.env (SPIKE_PK).
set -euo pipefail

RPC=${RPC:-https://rpc.testnet.arc.io}
PK=${PK:?set PK or source s02-escrow-deploy/.env}
ME=${ME:-$(cast wallet address --private-key "$PK")}
FLOOR_GWEI=20

echo "account=$ME"
echo "base_fee_gwei=$(( $(cast base-fee --rpc-url "$RPC") / 1000000000 ))"
echo "gas_price_gwei=$(( $(cast gas-price --rpc-url "$RPC") / 1000000000 ))"

echo "--- 1) send sub-floor tx (10 gwei, explicit gas limit to bypass estimation) ---"
LOW_HASH=$(cast send "$ME" --value 0 --gas-price 10000000000 --priority-gas-price 1000000000 --gas-limit 21000 \
  --private-key "$PK" --rpc-url "$RPC" --async 2>&1 || true)
echo "low_fee_tx=$LOW_HASH"

echo "--- 2) poll drop until evicted (raw RPC, non-blocking) ---"
START=$(date +%s)
EVICTED_AT=""
for i in $(seq 1 20); do
  REC=$(cast rpc eth_getTransactionReceipt "$LOW_HASH" --rpc-url "$RPC" 2>&1)
  TX=$(cast rpc eth_getTransactionByHash "$LOW_HASH" --rpc-url "$RPC" 2>&1)
  NOW=$(date +%s)
  echo "t=$((NOW-START))s receipt=${REC:0:14} in_mempool=$([ "$TX" = "null" ] && echo no || echo yes)"
  if [ "$REC" = "null" ] && [ "$TX" = "null" ]; then EVICTED_AT=$((NOW-START)); echo "EVICTED from mempool after ${EVICTED_AT}s (no receipt)"; break; fi
  sleep 3
done
[ -z "$EVICTED_AT" ] && echo "not evicted within window (still pending or mined)"

echo "--- 3) send control tx at 30 gwei, measure mine latency ---"
NONCE=$(cast nonce "$ME" --rpc-url "$RPC")
CTRL_HASH=$(cast send "$ME" --value 0 --gas-price 30000000000 --priority-gas-price 2000000000 --gas-limit 21000 \
  --nonce "$NONCE" --private-key "$PK" --rpc-url "$RPC" --async 2>&1)
START=$(date +%s)
for i in $(seq 1 20); do
  REC=$(cast rpc eth_getTransactionReceipt "$CTRL_HASH" --rpc-url "$RPC" 2>&1)
  if [ "$REC" != "null" ]; then
    NOW=$(date +%s)
    echo "control_tx=$CTRL_HASH mined_after=$((NOW-START))s block=$(echo "$REC" | jq -r .blockNumber) status=$(echo "$REC" | jq -r .status)"
    break
  fi
  sleep 1
done
