import {
  appendLedgerEntry,
  createTransaction,
  findActiveWalletByCampaignAndUser,
  findCampaignById,
  findTransactionByHash,
  incrementAttempts,
  listSubmittedRewards,
  setRewardRecipient,
  type Db,
  updateTransactionStatus,
} from "@spark/db";
import { createRewardEngine, type SettlementPort } from "@spark/reward";

export interface SettlementCycleDeps {
  db: Db;
  settlement: SettlementPort;
  limit?: number;
  maxAttempts?: number;
}

export interface SettlementCycleStats {
  submitted: number;
  confirmed: number;
  failed: number;
  retrying: number;
  held: number;
}

export async function runSettlementCycle(deps: SettlementCycleDeps): Promise<SettlementCycleStats> {
  const engine = createRewardEngine({ db: deps.db });
  const limit = deps.limit ?? 25;
  const maxAttempts = deps.maxAttempts ?? 5;
  const stats: SettlementCycleStats = {
    submitted: 0,
    confirmed: 0,
    failed: 0,
    retrying: 0,
    held: 0,
  };

  const authorized = await engine.listSettleable(limit);
  for (const reward of authorized) {
    try {
      let recipient = reward.recipientWallet;
      if (!recipient) {
        const association = await findActiveWalletByCampaignAndUser(
          deps.db,
          reward.campaignId,
          reward.recipientUserId,
        );
        if (!association) {
          stats.held += 1;
          continue;
        }
        recipient = association.address;
        await setRewardRecipient(deps.db, reward.id, recipient);
      }

      const campaign = await findCampaignById(deps.db, reward.campaignId);
      if (!campaign?.onChainCampaignId) continue;

      const { txHash } = await deps.settlement.submitPayout({
        campaignId: reward.campaignId,
        rewardId: reward.id,
        chainCampaignId: campaign.onChainCampaignId,
        onChainRewardId: reward.onChainRewardId,
        nonce: reward.authorizationNonce,
        recipientWallet: recipient,
        amountMicroUsdc: reward.amountMicroUsdc,
        deadline: BigInt(Math.floor(reward.authorizationExpiresAt.getTime() / 1000)),
      });
      await createTransaction(deps.db, {
        rewardId: reward.id,
        campaignId: reward.campaignId,
        chainId: campaign.chainId,
        txHash,
        transactionType: "REWARD_PAYOUT",
        status: "SUBMITTED",
        nonce: reward.authorizationNonce,
        submittedAt: new Date(),
      });
      await engine.markSubmitted(reward.id, txHash);
      stats.submitted += 1;
    } catch {
      await engine.markRetrying(reward.id);
      stats.retrying += 1;
    }
  }

  const submitted = await listSubmittedRewards(deps.db, limit);
  for (const reward of submitted) {
    if (!reward.transactionHash) continue;
    const txHash = reward.transactionHash;
    try {
      const status = await deps.settlement.getPayoutStatus(txHash);
      if (status === "confirmed") {
        await engine.markConfirmed(reward.id);
        await engine.markPaid(reward.id);
        await updateTransactionStatus(deps.db, txHash, "CONFIRMED", { confirmedAt: new Date() });
        const entryType = reward.rewardType === "REFERRAL" ? "REFERRAL_REWARD" : "USER_REWARD";
        await appendLedgerEntry(deps.db, {
          campaignId: reward.campaignId,
          rewardId: reward.id,
          entryType,
          amountMicroUsdc: reward.amountMicroUsdc,
          direction: -1,
          idempotencyKey: `reward:${reward.id}`,
        });
        stats.confirmed += 1;
      } else if (status === "failed") {
        await updateTransactionStatus(deps.db, txHash, "FAILED", {
          failureReason: "reverted",
        });
        await engine.markFailed(reward.id, "reverted");
        stats.failed += 1;
      } else {
        const tx = await findTransactionByHash(deps.db, txHash);
        const attempts = (tx?.attempts ?? 0) + 1;
        await incrementAttempts(deps.db, txHash);
        if (attempts >= maxAttempts) {
          await updateTransactionStatus(deps.db, txHash, "FAILED", { failureReason: "dropped" });
          await engine.markFailed(reward.id, "dropped");
          stats.failed += 1;
        } else {
          await engine.markRetrying(reward.id);
          stats.retrying += 1;
        }
      }
    } catch {
      // transient transport error; leave as SUBMITTED for the next tick
    }
  }

  return stats;
}
