/**
 * Arc chain constants and rules. All values verified in Phase 0 (docs/spikes).
 */
export const ARC_CHAIN_IDS = {
  mainnet: 5042,
  testnet: 5042002,
} as const;

export type ArcNetwork = keyof typeof ARC_CHAIN_IDS;

export const ARC_RPC_URLS: Record<ArcNetwork, string> = {
  mainnet: "https://rpc.mainnet.arc.io",
  testnet: "https://rpc.testnet.arc.io",
};

export const ARC_EXPLORER_URLS: Record<ArcNetwork, string> = {
  mainnet: "https://explorer.arc.io",
  testnet: "https://explorer.testnet.arc.io",
};

/** Native USDC. The ERC-20 interface shares the native balance. */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** EIP-7708 system emitter for native USDC movements (18 decimals). */
export const ARC_SYSTEM_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe" as const;

/** Deterministic finality: act after a single confirmation. */
export const ARC_CONFIRMATIONS = 1;

/** Mempool minimum; txs below this are silently dropped. */
export const ARC_MIN_MAX_FEE_PER_GAS_WEI = 20_000_000_000n;

export const USDC_ERC20_DECIMALS = 6;
export const USDC_NATIVE_DECIMALS = 18;
export const NATIVE_TO_ERC20_SCALE = 10n ** 12n;

export function nativeToErc20(native18: bigint): bigint {
  return native18 / NATIVE_TO_ERC20_SCALE;
}

export function erc20ToNative(erc20: bigint): bigint {
  return erc20 * NATIVE_TO_ERC20_SCALE;
}

/** Arc requires maxFeePerGas >= max(20 gwei, 2x base fee). */
export function requiredMaxFeePerGas(baseFeeWei: bigint): bigint {
  const doubled = baseFeeWei * 2n;
  return doubled > ARC_MIN_MAX_FEE_PER_GAS_WEI ? doubled : ARC_MIN_MAX_FEE_PER_GAS_WEI;
}
