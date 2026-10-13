import {
  createCampaign,
  createMembershipTask,
  createParticipation,
  type Db,
  findParticipationById,
  findRewardByType,
  setCampaignOnChainId,
  updateParticipationStatus,
  upsertUserByTelegramId,
  upsertWalletAssociation,
} from "@spark/db";
import { createMockSettlement, createRewardEngine } from "@spark/reward";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { runSettlementCycle } from "../src/settlement";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("settlement loop", () => {
  it("drives AUTHORIZED rewards through CONFIRMED to PAID", async () => {
    const engine = createRewardEngine({ db });
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9500n });
    const campaign = await createCampaign(db, {
      publicId: "settle0000000002",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    await setCampaignOnChainId(db, campaign.id, 1n, "0x00000000000000000000000000000000000000E5");
    await upsertWalletAssociation(db, {
      campaignId: campaign.id,
      userId: u.id,
      address: "0x00000000000000000000000000000000000000A1",
      normalizedAddress: "0x00000000000000000000000000000000000000a1",
    });
    const task = await createMembershipTask(db, {
      campaignId: campaign.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1006",
    });
    const p = await createParticipation(db, {
      campaignId: campaign.id,
      userId: u.id,
      taskId: task.id,
    });
    await updateParticipationStatus(db, p.id, "VERIFIED", { verifiedAt: new Date() });
    await engine.authorizeForParticipation(campaign.id, p.id);

    const stats = await runSettlementCycle({ db, settlement: createMockSettlement(), limit: 10 });
    expect(stats.submitted).toBe(1);
    expect(stats.confirmed).toBe(1);

    const reward = await findRewardByType(db, campaign.id, p.id, "USER_COMPLETION");
    expect(reward?.status).toBe("PAID");
    expect(reward?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await findParticipationById(db, p.id))?.status).toBe("REWARD_PENDING");
  });

  it("holds a reward when the user has no associated wallet", async () => {
    const engine = createRewardEngine({ db });
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9501n });
    const campaign = await createCampaign(db, {
      publicId: "settlehold0000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    await setCampaignOnChainId(db, campaign.id, 2n, "0x00000000000000000000000000000000000000E5");
    const task = await createMembershipTask(db, {
      campaignId: campaign.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1007",
    });
    const p = await createParticipation(db, {
      campaignId: campaign.id,
      userId: u.id,
      taskId: task.id,
    });
    await updateParticipationStatus(db, p.id, "VERIFIED", { verifiedAt: new Date() });
    await engine.authorizeForParticipation(campaign.id, p.id);

    const stats = await runSettlementCycle({ db, settlement: createMockSettlement(), limit: 10 });
    expect(stats.held).toBe(1);
    expect(stats.submitted).toBe(0);
    expect((await findRewardByType(db, campaign.id, p.id, "USER_COMPLETION"))?.status).toBe(
      "AUTHORIZED",
    );
  });
});
