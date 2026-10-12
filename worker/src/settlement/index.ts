import type { Db } from "@spark/db";
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
      const { txHash } = await settlement.submitPayout({
        campaignId: reward.campaignId,
        rewardId: reward.id,
        nonce: reward.authorizationNonce,
        recipientWallet: reward.recipientWallet,
        amountMicroUsdc: reward.amountMicroUsdc,
      });
      await engine.markSubmitted(reward.id, txHash);

      const status = await settlement.getPayoutStatus(txHash);
      if (status === "confirmed") {
        await engine.markConfirmed(reward.id);
        await engine.markPaid(reward.id);
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