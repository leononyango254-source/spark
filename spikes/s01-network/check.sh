#!/usr/bin/env bash
set -euo pipefail

RPC_TESTNET=https://rpc.testnet.arc.io
RPC_MAINNET=https://rpc.mainnet.arc.io
USDC=0x3600000000000000000000000000000000000000

echo "testnet_chainid=$(cast chain-id --rpc-url "$RPC_TESTNET")"
echo "mainnet_chainid=$(cast chain-id --rpc-url "$RPC_MAINNET")"
echo "testnet_block=$(cast block-number --rpc-url "$RPC_TESTNET")"
echo "mainnet_block=$(cast block-number --rpc-url "$RPC_MAINNET")"
echo "testnet_usdc_decimals=$(cast call "$USDC" 'decimals()(uint8)' --rpc-url "$RPC_TESTNET")"
echo "mainnet_usdc_decimals=$(cast call "$USDC" 'decimals()(uint8)' --rpc-url "$RPC_MAINNET")"
echo "testnet_usdc_symbol=$(cast call "$USDC" 'symbol()(string)' --rpc-url "$RPC_TESTNET")"
echo "testnet_usdc_codesize=$(cast codesize "$USDC" --rpc-url "$RPC_TESTNET")"
echo "testnet_gasprice_wei=$(cast gas-price --rpc-url "$RPC_TESTNET")"
echo "testnet_gasprice_gwei=$(cast gas-price --rpc-url "$RPC_TESTNET" --to-unit gwei 2>/dev/null || true)"
