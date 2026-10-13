import {
  createCampaign,
  createMembershipTask,
  createParticipation,
  type Db,
  findParticipationById,
  findRewardByType,
  updateParticipationStatus,
  upsertUserByTelegramId,
} from "@spark/db";
import { createRewardEngine } from "@spark/reward";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { settleAuthorizedRewards } from "../src/settlement";

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
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9400n });
    const campaign = await createCampaign(db, {
      publicId: "settle0000000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    const task = await createMembershipTask(db, {
      campaignId: campaign.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1005",
    });
    const p = await createParticipation(db, {
      campaignId: campaign.id,
      userId: u.id,
      taskId: task.id,
    });
    await updateParticipationStatus(db, p.id, "VERIFIED", { verifiedAt: new Date() });
    await engine.authorizeForParticipation(campaign.id, p.id);

    expect(await settleAuthorizedRewards({ db, limit: 10 })).toBe(1);

    const reward = await findRewardByType(db, campaign.id, p.id, "USER_COMPLETION");
    expect(reward?.status).toBe("PAID");
    expect(reward?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await findParticipationById(db, p.id))?.status).toBe("REWARD_PENDING");
  });
});
