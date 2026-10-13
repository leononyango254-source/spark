import { describe, expect, it, vi } from "vitest";
import { createOnchainSettlement } from "../src/settlement/port";

const ESCROW = "0x00000000000000000000000000000000000000E5" as const;

function fakeWallet(overrides: { receipt?: unknown } = {}) {
  const sendTransaction = vi.fn(async () => ({ hash: `0x${"a".repeat(64)}` as const, nonce: 1 }));
  const getReceipt = vi.fn(async () => {
    if (overrides.receipt === undefined) return null;
    return overrides.receipt;
  });
  return {
    wallet: {
      address: "0x00000000000000000000000000000000000000A1" as const,
      getNonce: vi.fn(),
      sendTransaction,
      getReceipt,
    },
    sendTransaction,
  };
}

const request = {
  campaignId: "camp",
  rewardId: "reward",
  chainCampaignId: 1n,
  onChainRewardId: 42n,
  nonce: 7n,
  recipientWallet: "0x00000000000000000000000000000000000000A1",
  amountMicroUsdc: 750_000n,
  deadline: 1_700_000_000n,
};

describe("createOnchainSettlement", () => {
  it("encodes and submits payReward to the escrow", async () => {
    const { wallet, sendTransaction } = fakeWallet({ receipt: { status: "success" } });
    // biome-ignore lint/suspicious/noExplicitAny: test fake wallet
    const port = createOnchainSettlement({ wallet: wallet as any, escrowAddress: ESCROW });
    const { txHash } = await port.submitPayout(request);
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: ESCROW, data: expect.stringMatching(/^0x/) }),
    );
  });

  it("derives status from the receipt", async () => {
    const confirmed = fakeWallet({ receipt: { status: "success" } });
    // biome-ignore lint/suspicious/noExplicitAny: test fake wallet
    const p1 = createOnchainSettlement({ wallet: confirmed.wallet as any, escrowAddress: ESCROW });
    expect(await p1.getPayoutStatus(`0x${"a".repeat(64)}`)).toBe("confirmed");

    const reverted = fakeWallet({ receipt: { status: "reverted" } });
    // biome-ignore lint/suspicious/noExplicitAny: test fake wallet
    const p2 = createOnchainSettlement({ wallet: reverted.wallet as any, escrowAddress: ESCROW });
    expect(await p2.getPayoutStatus(`0x${"a".repeat(64)}`)).toBe("failed");

    const pending = fakeWallet();
    // biome-ignore lint/suspicious/noExplicitAny: test fake wallet
    const p3 = createOnchainSettlement({ wallet: pending.wallet as any, escrowAddress: ESCROW });
    expect(await p3.getPayoutStatus(`0x${"a".repeat(64)}`)).toBe("pending");
  });
});
