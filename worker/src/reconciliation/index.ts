import { getRewardPaidLogs, type RewardPaidEvent } from "@spark/arc";
import {
  appendLedgerEntry,
  countPaidRewardsWithoutEvent,
  type Db,
  findCampaignByOnChainId,
  findRewardByOnChainId,
  getCursor,
  insertEvent,
  setCursor,
} from "@spark/db";
import { createRewardEngine } from "@spark/reward";
import type { Address } from "@spark/wallet";
import type { PublicClient } from "viem";

export interface ReconcileDeps {
  db: Db;
  publicClient: Pick<PublicClient, "getBlockNumber">;
  escrowAddress: Address;
  chainId: number;
  /** Blocks to scan behind `latest` on the very first run (cursor still at 0). */
  lookbackBlocks?: bigint;
  /** Max blocks scanned per run; long catch-ups progress across runs without gaps. */
  maxScanBlocks?: bigint;
  fetchLogs?: (
    escrowAddress: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<RewardPaidEvent[]>;
}

export const RECONCILE_LOOKBACK_BLOCKS = 10_000n;
export const RECONCILE_MAX_SCAN_BLOCKS = 100_000n;

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
  const stored = await getCursor(deps.db, deps.chainId, deps.escrowAddress);
  const lookback = deps.lookbackBlocks ?? RECONCILE_LOOKBACK_BLOCKS;
  const maxScan = deps.maxScanBlocks ?? RECONCILE_MAX_SCAN_BLOCKS;
  const from = stored === 0n ? (latest > lookback ? latest - lookback : 0n) : stored;
  if (latest < from) {
    stats.diverged = await countPaidRewardsWithoutEvent(deps.db);
    return stats;
  }

  const cappedTo = from + maxScan - 1n;
  const scanTo = cappedTo < latest ? cappedTo : latest;

  const fetchLogs =
    deps.fetchLogs ??
    ((address: Address, fromBlock: bigint, toBlock: bigint) =>
      getRewardPaidLogs(deps.publicClient as PublicClient, address, fromBlock, toBlock));
  const logs = await fetchLogs(deps.escrowAddress, from, scanTo);
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

  const nextCursor = scanTo >= latest ? latest + 1n : scanTo + 1n;
  await setCursor(deps.db, deps.chainId, deps.escrowAddress, nextCursor);
  stats.diverged = await countPaidRewardsWithoutEvent(deps.db);
  return stats;
}
