import type { PublicClient } from "viem";
import { getRewardPaidLogs, type RewardPaidEvent } from "@spark/arc";
import {
  appendLedgerEntry,
  countPaidRewardsWithoutEvent,
  findCampaignByOnChainId,
  findRewardByOnChainId,
  getCursor,
  insertEvent,
  setCursor,
  type Db,
} from "@spark/db";
import { createRewardEngine } from "@spark/reward";
import type { Address } from "@spark/wallet";

export interface ReconcileDeps {
  db: Db;
  publicClient: Pick<PublicClient, "getBlockNumber">;
  escrowAddress: Address;
  chainId: number;
  fetchLogs?: (
    escrowAddress: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<RewardPaidEvent[]>;
}

export interface ReconcileStats {
  scanned: number;
  inserted: number;
  healed: number;
  diverged: number;
}

export async function runReconciliation(deps: ReconcileDeps): Promise<ReconcileStats> {
  const engine = createRewardEngine({ db: deps.db });
  const stats: ReconcileStats = { scanned: 0, inserted: 0, healed: 0, diverged: 0 };

  const latest = await deps.publicClient.getBlockNumber();
  const from = await getCursor(deps.db, deps.chainId, deps.escrowAddress);
  if (latest < from) {
    stats.diverged = await countPaidRewardsWithoutEvent(deps.db);
    return stats;
  }

  const fetchLogs =
    deps.fetchLogs ??
    ((address: Address, fromBlock: bigint, toBlock: bigint) =>
      getRewardPaidLogs(deps.publicClient as PublicClient, address, fromBlock, toBlock));
  const logs = await fetchLogs(deps.escrowAddress, from, latest);
  stats.scanned = logs.length;

  for (const log of logs) {
    const campaign = await findCampaignByOnChainId(deps.db, deps.chainId, log.campaignId);
    if (!campaign) continue;

    const inserted = await insertEvent(deps.db, {
      campaignId: campaign.id,
      eventType: "RewardPaid",
      chainId: deps.chainId,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
      payload: {
        onChainCampaignId: log.campaignId.toString(),
        onChainRewardId: log.rewardId.toString(),
        to: log.to,
        amount: log.amount.toString(),
        nonce: log.nonce.toString(),
      },
    });
    if (inserted) stats.inserted += 1;

    const reward = await findRewardByOnChainId(deps.db, log.rewardId);
    if (!reward) continue;
    if (reward.status === "PAID") continue;

    await engine.markConfirmed(reward.id);
    await engine.markPaid(reward.id);
    await appendLedgerEntry(deps.db, {
      campaignId: reward.campaignId,
      rewardId: reward.id,
      entryType: reward.rewardType === "REFERRAL" ? "REFERRAL_REWARD" : "USER_REWARD",
      amountMicroUsdc: reward.amountMicroUsdc,
      direction: -1,
      idempotencyKey: `reward:${reward.id}`,
    });
    stats.healed += 1;
  }

  await setCursor(deps.db, deps.chainId, deps.escrowAddress, latest + 1n);
  stats.diverged = await countPaidRewardsWithoutEvent(deps.db);
  return stats;
}
