import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCampaign,
  createReward,
  findActiveWalletByCampaignAndUser,
  findRewardByOnChainId,
  getCursor,
  insertEvent,
  nextRewardRef,
  setCursor,
  upsertWalletAssociation,
  upsertUserByTelegramId,
} from "../src";
import type { Db } from "../src";
import { type Harness, startHarness } from "./harness";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("phase 5 repositories", () => {
  it("allocates unique on-chain reward refs", async () => {
    const a = await nextRewardRef(db);
    const b = await nextRewardRef(db);
    expect(b).toBe(a + 1n);
  });

  it("finds a reward by on-chain id", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 8100n });
    const campaign = await createCampaign(db, {
      publicId: "reporepo00000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    const ref = await nextRewardRef(db);
    const reward = await createReward(db, {
      campaignId: campaign.id,
      rewardType: "USER_COMPLETION",
      recipientUserId: u.id,
      onChainRewardId: ref,
      amountMicroUsdc: 100_000n,
      authorizationNonce: await nextRewardRef(db),
      authorizationExpiresAt: new Date(Date.now() + 86_400_000),
      status: "AUTHORIZED",
      chainId: 5042002,
    });
    expect((await findRewardByOnChainId(db, ref))?.id).toBe(reward.id);
  });

  it("stores wallet associations idempotently", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9401n });
    const campaign = await createCampaign(db, {
      publicId: "walletassoc000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 1n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1n,
      balanceMicroUsdc: 0n,
      status: "ACTIVE",
    });
    await upsertWalletAssociation(db, {
      campaignId: campaign.id,
      userId: u.id,
      address: "0xAAA",
      normalizedAddress: "0xaaa",
    });
    await upsertWalletAssociation(db, {
      campaignId: campaign.id,
      userId: u.id,
      address: "0xBBB",
      normalizedAddress: "0xbbb",
    });
    expect((await findActiveWalletByCampaignAndUser(db, campaign.id, u.id))?.address).toBe("0xBBB");
  });

  it("advances a chain cursor", async () => {
    expect(await getCursor(db, 5042002, "0xescrow")).toBe(0n);
    await setCursor(db, 5042002, "0xescrow", 100n);
    await setCursor(db, 5042002, "0xescrow", 120n);
    expect(await getCursor(db, 5042002, "0xescrow")).toBe(120n);
  });

  it("deduplicates campaign events on (chain, tx, logIndex)", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9402n });
    const campaign = await createCampaign(db, {
      publicId: "eventsdedupe000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 1n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1n,
      balanceMicroUsdc: 0n,
      status: "ACTIVE",
    });
    const input = {
      campaignId: campaign.id,
      chainId: 5042002,
      eventType: "REWARD_PAID",
      blockNumber: 5n,
      logIndex: 0,
      transactionHash: `0x${"a".repeat(64)}`,
      payload: { rewardId: "1" },
    };
    expect(await insertEvent(db, input)).not.toBeNull();
    expect(await insertEvent(db, input)).toBeNull();
  });
});
