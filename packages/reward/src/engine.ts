import type { Db, RewardRow } from "@spark/db";
import {
  createReward,
  findCampaignById,
  findParticipationById,
  findReferral,
  findRewardById,
  listSettleableRewards,
  nextRewardNonce,
  reserveCampaignBudget,
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
        recipientWallet: "0x0000000000000000000000000000000000000000",
        amountMicroUsdc: campaign.rewardMicroUsdc,
        authorizationNonce: await nextRewardNonce(db),
        authorizationExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        status: "AUTHORIZED",
        chainId: campaign.chainId,
      });
      if (userReward) created.push(userReward);

      if (hasQualifiedReferral) {
        const referralReward = await createReward(db, {
          campaignId,
          participationId,
          rewardType: "REFERRAL",
          recipientUserId: referral.referrerUserId,
          recipientWallet: "0x0000000000000000000000000000000000000000",
          amountMicroUsdc: campaign.referralRewardMicroUsdc,
          authorizationNonce: await nextRewardNonce(db),
          authorizationExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
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
      await updateRewardStatus(db, rewardId, "PAID", { confirmedAt: new Date() });
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

    async markSubmissionFailed(rewardId) {
      await updateRewardStatus(db, rewardId, "SUBMISSION_FAILED");
    },
  };
}
