import {
  type Address,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
} from "viem";
import { campaignEscrowAbi, usdcErc20Abi } from "./abi";

export interface PayRewardArgs {
  campaignId: bigint;
  rewardId: bigint;
  nonce: bigint;
  recipient: Address;
  amount: bigint;
  deadline: bigint;
}

export function encodePayReward(args: PayRewardArgs): Hex {
  return encodeFunctionData({
    abi: campaignEscrowAbi,
    functionName: "payReward",
    args: [args.campaignId, args.rewardId, args.nonce, args.recipient, args.amount, args.deadline],
  });
}

export interface RewardPaidEvent {
  campaignId: bigint;
  rewardId: bigint;
  to: Address;
  amount: bigint;
  nonce: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export function decodeRewardPaid(topics: readonly Hex[], data: Hex): RewardPaidEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: campaignEscrowAbi,
      eventName: "RewardPaid",
      topics: topics as [Hex, ...Hex[]],
      data,
    });
    const args = decoded.args as unknown as {
      campaignId: bigint;
      rewardId: bigint;
      to: Address;
      amount: bigint;
      nonce: bigint;
    };
    return {
      campaignId: args.campaignId,
      rewardId: args.rewardId,
      to: args.to,
      amount: args.amount,
      nonce: args.nonce,
      blockNumber: 0n,
      transactionHash: "0x",
      logIndex: 0,
    };
  } catch {
    return null;
  }
}

export interface RawLog {
  address?: Address;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
  topics: readonly Hex[];
  data: Hex;
}

export function decodeRewardPaidLog(log: RawLog): RewardPaidEvent | null {
  const decoded = decodeRewardPaid(log.topics, log.data);
  if (!decoded) return null;
  return {
    ...decoded,
    blockNumber: log.blockNumber ?? 0n,
    transactionHash: log.transactionHash ?? ("0x" as Hex),
    logIndex: log.logIndex ?? 0,
  };
}

/** Some Arc RPC providers cap `eth_getLogs` to a 10,000-block range. */
export const ARC_MAX_LOG_RANGE = 10_000n;

export async function getRewardPaidLogs(
  publicClient: PublicClient,
  escrowAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RewardPaidEvent[]> {
  const events: RewardPaidEvent[] = [];
  for (let start = fromBlock; start <= toBlock; start += ARC_MAX_LOG_RANGE) {
    const windowEnd = start + ARC_MAX_LOG_RANGE - 1n;
    const chunkTo = windowEnd < toBlock ? windowEnd : toBlock;
    const logs = await publicClient.getLogs({
      address: escrowAddress,
      fromBlock: start,
      toBlock: chunkTo,
    });
    for (const log of logs) {
      const event = decodeRewardPaidLog(log as unknown as RawLog);
      if (event) events.push(event);
    }
  }
  return events;
}

import { defineChain } from "viem";

export function createArcPublicClient(rpcUrl: string, chainId: number): PublicClient {
  return createPublicClient({
    transport: http(rpcUrl),
    chain: defineChain({
      id: chainId,
      name: "arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }),
  });
}

export function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: usdcErc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function encodeCreateCampaign(creator: Address, budget: bigint, deadline: bigint): Hex {
  return encodeFunctionData({
    abi: campaignEscrowAbi,
    functionName: "createCampaign",
    args: [creator, budget, deadline],
  });
}

export function encodeFundCampaign(campaignId: bigint, amount: bigint): Hex {
  return encodeFunctionData({
    abi: campaignEscrowAbi,
    functionName: "fundCampaign",
    args: [campaignId, amount],
  });
}
