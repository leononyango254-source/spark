import type { Db } from "@spark/db";
import type { RewardRow } from "@spark/db";
import { listSettleableRewards, updateRewardStatus, createReward, findCampaignById, findParticipationById, nextRewardNonce, updateParticipationStatus } from "@spark/db";

export interface RewardEngine {
  authorizeForParticipation(campaignId: string, participationId: string): Promise<RewardRow[]>;
  listSettleable(limit: number): Promise<RewardRow[]>;
  markSubmitted(rewardId: string, txHash: string): Promise<void>;
  markConfirmed(rewardId: string): Promise<void>;
  markPaid(rewardId: string): Promise<void>;
  markSubmissionFailed(rewardId: string): Promise<void>;
}

export function createRewardEngine(deps: { db: Db }): RewardEngine {
  const db = deps.db;

  return {
    async authorizeForParticipation(campaignId, participationId) {
      const campaign = await findCampaignById(db, campaignId);
      if (!campaign) return [];

      const participation = await findParticipationById(db, participationId);
      if (!participation) return [];

      if (campaign.status !== "ACTIVE") return [];

      if (participation.status !== "VERIFIED") return [];

      const created: RewardRow[] = [];

      const userReward = await createReward(db, {
        campaignId,
        participationId,
        rewardType: "USER_COMPLETION",
        recipientUserId: participation.userId,
        recipientWallet: "0x0000000000000000000000000000000000000000",
        amountMicroUsdc: campaign.rewardMicroUsdc,
        authorizationNonce: await nextRewardNonce(db),
        authorizationExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        status: "AUTHORIZED",
        chainId: campaign.chainId,
      });
      if (userReward) created.push(userReward);

await updateParticipationStatus(db, participationId, "REWARD_PENDING", {});
      return created;
    },

    listSettleable: (limit) => listSettleableRewards(db, limit),

    async markSubmitted(rewardId, txHash) {
      await updateRewardStatus(db, rewardId, "SUBMITTED", {
        transactionHash: txHash,
        submittedAt: new Date(),
      });
    },

    async markConfirmed(rewardId) {
      await updateRewardStatus(db, rewardId, "CONFIRMED", { confirmedAt: new Date() });
    },

    async markPaid(rewardId) {
      await updateRewardStatus(db, rewardId, "PAID", { confirmedAt: new Date() });
    },

    async markSubmissionFailed(rewardId) {
      await updateRewardStatus(db, rewardId, "SUBMISSION_FAILED");
    },
  };
}