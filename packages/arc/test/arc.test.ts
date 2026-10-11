import { describe, expect, it } from "vitest";
import {
  ARC_CHAIN_IDS,
  ARC_MIN_MAX_FEE_PER_GAS_WEI,
  erc20ToNative,
  nativeToErc20,
  requiredMaxFeePerGas,
} from "../src/index";

describe("arc constants", () => {
  it("has correct chain ids", () => {
    expect(ARC_CHAIN_IDS.mainnet).toBe(5042);
    expect(ARC_CHAIN_IDS.testnet).toBe(5042002);
  });

  it("converts between native (18dp) and erc20 (6dp) views", () => {
    expect(erc20ToNative(1_099_985n)).toBe(1_099_985_000_000_000_000n);
    expect(nativeToErc20(1_099_985_000_000_000_000n)).toBe(1_099_985n);
  });

  it("enforces the 20 gwei floor and doubling", () => {
    const gwei = 1_000_000_000n;
    expect(requiredMaxFeePerGas(5n * gwei)).toBe(ARC_MIN_MAX_FEE_PER_GAS_WEI);
    expect(requiredMaxFeePerGas(40n * gwei)).toBe(80n * gwei);
  });
});
