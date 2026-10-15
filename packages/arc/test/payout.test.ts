import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";
import { campaignEscrowAbi, decodeRewardPaidLog, encodePayReward, getRewardPaidLogs } from "../src";

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

const ESCROW = "0x00000000000000000000000000000000000000E5" as const;

function rawRewardPaid(rewardId: bigint) {
  const topics = encodeEventTopics({
    abi: campaignEscrowAbi,
    eventName: "RewardPaid",
    args: { campaignId: 1n, rewardId, to: "0x00000000000000000000000000000000000000A1" },
  }) as readonly `0x${string}`[];
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [750_000n, 7n]);
  return {
    blockNumber: 12_345n,
    transactionHash: `0x${"b".repeat(64)}` as const,
    logIndex: 2,
    topics,
    data,
  };
}

function fakeClient(calls: Array<[bigint, bigint]>, onCall?: (fromBlock: bigint) => unknown[]) {
  return {
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push([fromBlock, toBlock]);
      return onCall?.(fromBlock) ?? [];
    },
  };
}

describe("getRewardPaidLogs", () => {
  it("splits a block range into <=10,000-block windows", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const client = fakeClient(calls, (fromBlock) =>
      fromBlock === 10_000n ? [rawRewardPaid(42n)] : [],
    );
    const events = await getRewardPaidLogs(client as never, ESCROW, 0n, 25_000n);
    expect(calls).toEqual([
      [0n, 9_999n],
      [10_000n, 19_999n],
      [20_000n, 25_000n],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.rewardId).toBe(42n);
  });

  it("handles an exact multiple of the window size", async () => {
    const calls: Array<[bigint, bigint]> = [];
    await getRewardPaidLogs(fakeClient(calls) as never, ESCROW, 0n, 19_999n);
    expect(calls).toEqual([
      [0n, 9_999n],
      [10_000n, 19_999n],
    ]);
  });

  it("returns no events and makes no calls when the range is empty", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const events = await getRewardPaidLogs(fakeClient(calls) as never, ESCROW, 5n, 4n);
    expect(events).toEqual([]);
    expect(calls).toEqual([]);
  });
});
