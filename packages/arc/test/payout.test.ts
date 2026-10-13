import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";
import { campaignEscrowAbi, decodeRewardPaidLog, encodePayReward } from "../src";

describe("arc payout encoding", () => {
  it("encodes payReward with the frozen signature", () => {
    const data = encodePayReward({
      campaignId: 1n,
      rewardId: 42n,
      nonce: 7n,
      recipient: "0x00000000000000000000000000000000000000A1",
      amount: 750_000n,
      deadline: 1_700_000_000n,
    });
    expect(data.startsWith("0x")).toBe(true);
    expect(data.length).toBe(2 + 8 + 6 * 64);
  });

  it("round-trips a RewardPaid log", () => {
    const topics = encodeEventTopics({
      abi: campaignEscrowAbi,
      eventName: "RewardPaid",
      args: { campaignId: 1n, rewardId: 42n, to: "0x00000000000000000000000000000000000000A1" },
    }) as readonly `0x${string}`[];
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [750_000n, 7n]);
    const event = decodeRewardPaidLog({
      blockNumber: 10n,
      transactionHash: `0x${"b".repeat(64)}`,
      logIndex: 3,
      topics,
      data,
    });
    expect(event?.campaignId).toBe(1n);
    expect(event?.rewardId).toBe(42n);
    expect(event?.amount).toBe(750_000n);
    expect(event?.nonce).toBe(7n);
    expect(event?.logIndex).toBe(3);
  });

  it("returns null for non-RewardPaid logs", () => {
    expect(
      decodeRewardPaidLog({
        blockNumber: 1n,
        transactionHash: `0x${"0".repeat(64)}`,
        logIndex: 0,
        topics: [`0x${"1".repeat(64)}`] as readonly `0x${string}`[],
        data: "0x",
      }),
    ).toBeNull();
  });
});
