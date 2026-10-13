import type { Db, RewardRow } from "@spark/db";
import {
  createReward,
  findCampaignById,
  findParticipationById,
  findReferral,
  findRewardById,
  listSettleableRewards,
  nextRewardNonce,
  nextRewardRef,
  reserveCampaignBudget,
  setRewardRecipient,
  updateParticipationStatus,
  updateReferralStatus,
  updateRewardStatus,
} from "@spark/db";

export interface RewardEngine {
  authorizeForParticipation(campaignId: string, participationId: string): Promise<RewardRow[]>;
  listSettleable(limit: number): Promise<RewardRow[]>;
  markSubmitted(rewardId: string, txHash: string): Promise<void>;
  markConfirmed(rewardId: string): Promise<void>;
  markPaid(rewardId: string): Promise<void>;
  markSubmissionFailed(rewardId: string): Promise<void>;
  markRetrying(rewardId: string): Promise<void>;
  markFailed(rewardId: string, reason?: string): Promise<void>;
  setRecipient(rewardId: string, recipientWallet: string): Promise<void>;
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

      // Check for qualified referral
      const referral = await findReferral(db, campaignId, participation.userId);
      const hasQualifiedReferral =
        referral && referral.status === "QUALIFIED" && campaign.referralRewardMicroUsdc > 0n;

      // Calculate total amount to reserve
      const totalAmount =
        campaign.rewardMicroUsdc + (hasQualifiedReferral ? campaign.referralRewardMicroUsdc : 0n);

      // Atomically reserve budget
      const reserved = await reserveCampaignBudget(db, campaignId, totalAmount);
      if (!reserved) return [];

      const created: RewardRow[] = [];

      const userReward = await createReward(db, {
        campaignId,
        participationId,
        rewardType: "USER_COMPLETION",
        recipientUserId: participation.userId,
        onChainRewardId: await nextRewardRef(db),
        amountMicroUsdc: campaign.rewardMicroUsdc,
        authorizationNonce: await nextRewardNonce(db),
        authorizationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "AUTHORIZED",
        chainId: campaign.chainId,
      });
      if (userReward) created.push(userReward);

      if (hasQualifiedReferral) {
        const referralReward = await createReward(db, {
          campaignId,
          participationId,
          rewardType: "REFERRAL",
          recipientUserId: participation.userId,
          onChainRewardId: await nextRewardRef(db),
          amountMicroUsdc: campaign.referralRewardMicroUsdc,
          authorizationNonce: await nextRewardNonce(db),
          authorizationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: "AUTHORIZED",
          chainId: campaign.chainId,
        });
        if (referralReward) {
          created.push(referralReward);
          await updateReferralStatus(db, referral.id, "REWARD_PENDING");
        }
      }

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
      const reward = await findRewardById(db, rewardId);
      await updateRewardStatus(db, rewardId, "PAID", { paidAt: new Date() });
      if (reward?.rewardType === "REFERRAL" && reward.participationId) {
        const participation = await findParticipationById(db, reward.participationId);
        if (participation) {
          const referral = await findReferral(db, reward.campaignId, participation.userId);
          if (referral && referral.status === "REWARD_PENDING") {
            await updateReferralStatus(db, referral.id, "PAID");
          }
        }
      }
    },

    setRecipient: (rewardId, wallet) => setRewardRecipient(db, rewardId, wallet),

    async markRetrying(rewardId) {
      await updateRewardStatus(db, rewardId, "RETRYING");
    },

    async markFailed(rewardId, reason) {
      await updateRewardStatus(db, rewardId, "FAILED", {
        failedAt: new Date(),
        ...(reason ? { failureReason: reason } : {}),
      });
    },

    async markSubmissionFailed(rewardId) {
      await updateRewardStatus(db, rewardId, "SUBMISSION_FAILED", { failedAt: new Date() });
    },
  };
}
