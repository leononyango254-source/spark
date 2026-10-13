import type { Db } from "@spark/db";
import { appendLedgerEntry, findCampaignById } from "@spark/db";
import { createMockSettlement, createRewardEngine, type SettlementPort } from "@spark/reward";

export interface SettlementDeps {
  db: Db;
  settlement?: SettlementPort;
  limit?: number;
}

export async function settleAuthorizedRewards(deps: SettlementDeps): Promise<number> {
  const settlement = deps.settlement ?? createMockSettlement();
  const engine = createRewardEngine({ db: deps.db });
  const rewards = await engine.listSettleable(deps.limit ?? 25);
  let processed = 0;

  for (const reward of rewards) {
    try {
      if (!reward.recipientWallet) {
        await engine.markSubmissionFailed(reward.id);
        continue;
      }
      const campaign = await findCampaignById(deps.db, reward.campaignId);
      if (!campaign || !campaign.onChainCampaignId) {
        await engine.markSubmissionFailed(reward.id);
        continue;
      }
      const { txHash } = await settlement.submitPayout({
        campaignId: reward.campaignId,
        rewardId: reward.id,
        chainCampaignId: campaign.onChainCampaignId,
        onChainRewardId: reward.onChainRewardId,
        nonce: reward.authorizationNonce,
        recipientWallet: reward.recipientWallet,
        amountMicroUsdc: reward.amountMicroUsdc,
        deadline: BigInt(Math.floor(reward.authorizationExpiresAt.getTime() / 1000)),
      });
      await engine.markSubmitted(reward.id, txHash);

      const status = await settlement.getPayoutStatus(txHash);
      if (status === "confirmed") {
        await engine.markConfirmed(reward.id);
        await engine.markPaid(reward.id);

        const entryType = reward.rewardType === "REFERRAL" ? "REFERRAL_REWARD" : "USER_REWARD";
        await appendLedgerEntry(deps.db, {
          campaignId: reward.campaignId,
          rewardId: reward.id,
          entryType,
          amountMicroUsdc: reward.amountMicroUsdc,
          direction: -1,
          idempotencyKey: `reward:${reward.id}`,
        });

        processed += 1;
      } else if (status === "failed") {
        await engine.markSubmissionFailed(reward.id);
      }
    } catch {
      await engine.markSubmissionFailed(reward.id);
    }
  }

  return processed;
}
