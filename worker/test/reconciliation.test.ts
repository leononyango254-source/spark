import {
  countPaidRewardsWithoutEvent,
  createCampaign,
  createReward,
  findRewardById,
  getCursor,
  type Db,
  nextRewardRef,
  setCampaignOnChainId,
  upsertUserByTelegramId,
} from "@spark/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { runReconciliation } from "../src/reconciliation";

const ESCROW = "0x00000000000000000000000000000000000000E5" as const;
const CHAIN = 5042002;

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

async function seed(telegramId: bigint, publicId: string, onChainCampaignId: bigint) {
  const u = await upsertUserByTelegramId(db, { telegramUserId: telegramId });
  const campaign = await createCampaign(db, {
    publicId,
    creatorId: u.id,
    chainId: CHAIN,
    rewardMicroUsdc: 100_000n,
    referralRewardMicroUsdc: 0n,
    budgetMicroUsdc: 1_000_000n,
    balanceMicroUsdc: 1_000_000n,
    status: "ACTIVE",
  });
  await setCampaignOnChainId(db, campaign.id, onChainCampaignId, ESCROW);
  const onChainRewardId = await nextRewardRef(db);
  const reward = await createReward(db, {
    campaignId: campaign.id,
    rewardType: "USER_COMPLETION",
    recipientUserId: u.id,
    recipientWallet: "0x00000000000000000000000000000000000000A1",
    onChainRewardId,
    amountMicroUsdc: 100_000n,
    authorizationNonce: await nextRewardRef(db),
    authorizationExpiresAt: new Date(Date.now() + 3_600_000),
    status: "SUBMITTED",
    transactionHash: `0x${"a".repeat(64)}`,
    chainId: CHAIN,
  });
  return { campaign, reward, onChainRewardId };
}

function event(onChainCampaignId: bigint, onChainRewardId: bigint, logIndex = 0) {
  return {
    campaignId: onChainCampaignId,
    rewardId: onChainRewardId,
    to: "0x00000000000000000000000000000000000000A1" as const,
    amount: 100_000n,
    nonce: 1n,
    blockNumber: 100n,
    transactionHash: `0x${"a".repeat(64)}` as const,
    logIndex,
  };
}

describe("reward reconciliation", () => {
  it("self-heals a reward from a RewardPaid event and advances the cursor", async () => {
    const { reward, onChainRewardId } = await seed(9700n, "reconheal0000002", 500n);
    const stats = await runReconciliation({
      db,
      chainId: CHAIN,
      escrowAddress: ESCROW,
      publicClient: { getBlockNumber: vi.fn(async () => 100n) },
      fetchLogs: async () => [event(500n, onChainRewardId)],
    });
    expect(stats.inserted).toBe(1);
    expect(stats.healed).toBe(1);
    expect((await findRewardById(db, reward.id))?.status).toBe("PAID");
    expect(await getCursor(db, CHAIN, ESCROW)).toBe(101n);
  });

  it("is idempotent across repeated runs", async () => {
    const { onChainRewardId } = await seed(9701n, "reconidem0000001", 501n);
    const deps = {
      db,
      chainId: CHAIN,
      escrowAddress: ESCROW,
      publicClient: { getBlockNumber: vi.fn(async () => 100n) },
      fetchLogs: async () => [event(501n, onChainRewardId)],
    };
    await runReconciliation(deps);
    const second = await runReconciliation(deps);
    expect(second.healed).toBe(0);
    expect(second.inserted).toBe(0);
  });

  it("flags divergence for a PAID reward with no on-chain event", async () => {
    const { reward } = await seed(9702n, "recondiverge00001", 502n);
    const engine = (await import("@spark/reward")).createRewardEngine({ db });
    await engine.markConfirmed(reward.id);
    await engine.markPaid(reward.id);
    const tx = await import("@spark/db");
    await tx.createTransaction(db, {
      rewardId: reward.id,
      campaignId: reward.campaignId,
      chainId: CHAIN,
      txHash: `0x${"c".repeat(64)}`,
      transactionType: "REWARD_PAYOUT",
      status: "CONFIRMED",
      submittedAt: new Date(),
      confirmedAt: new Date(),
    });
    expect(await countPaidRewardsWithoutEvent(db)).toBe(1);
    const stats = await runReconciliation({
      db,
      chainId: CHAIN,
      escrowAddress: ESCROW,
      publicClient: { getBlockNumber: vi.fn(async () => 100n) },
      fetchLogs: async () => [],
    });
    expect(stats.diverged).toBeGreaterThanOrEqual(1);
  });
});
