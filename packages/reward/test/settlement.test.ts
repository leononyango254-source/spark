import { describe, expect, it } from "vitest";
import { createMockSettlement } from "../src";

describe("MockSettlement", () => {
  it("returns a stable hash and confirms payouts", async () => {
    const settlement = createMockSettlement();
    const first = await settlement.submitPayout({
      campaignId: "c1",
      rewardId: "r1",
      nonce: 1n,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
    });
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await settlement.getPayoutStatus(first.txHash)).toBe("confirmed");
    const second = await settlement.submitPayout({
      campaignId: "c1",
      rewardId: "r1",
      nonce: 1n,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
    });
    expect(second.txHash).toBe(first.txHash);
  });

  it("reports failed for an unknown hash", async () => {
    const settlement = createMockSettlement();
    expect(await settlement.getPayoutStatus(`0x${"0".repeat(64)}`)).toBe("failed");
  });
});
