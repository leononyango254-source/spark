import { createCampaign, upsertUserByTelegramId } from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../db/test/harness";
import { createReferralEngine } from "../src";
import { assertReferralTransition, canTransitionReferral } from "../src/state";

let h: Harness;
let db: any;
let engine: ReturnType<typeof createReferralEngine>;

beforeAll(async () => {
  h = await startHarness();
  db = h.db;
  engine = createReferralEngine({ db });
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("ReferralState", () => {
  it("allows only canonical transitions", () => {
    expect(canTransitionReferral("ATTRIBUTED", "QUALIFIED")).toBe(true);
    expect(canTransitionReferral("ATTRIBUTED", "REJECTED")).toBe(true);
    expect(canTransitionReferral("QUALIFIED", "REWARD_PENDING")).toBe(true);
    expect(canTransitionReferral("QUALIFIED", "REJECTED")).toBe(true);
    expect(canTransitionReferral("REWARD_PENDING", "PAID")).toBe(true);
    expect(canTransitionReferral("REWARD_PENDING", "REJECTED")).toBe(true);
    expect(canTransitionReferral("PAID", "REJECTED")).toBe(false);
    expect(canTransitionReferral("REJECTED", "ATTRIBUTED")).toBe(false);
    expect(canTransitionReferral("PAID", "QUALIFIED")).toBe(false);
  });

  it("asserts valid transitions pass", () => {
    expect(() => assertReferralTransition("ATTRIBUTED", "QUALIFIED")).not.toThrow();
    expect(() => assertReferralTransition("QUALIFIED", "REWARD_PENDING")).not.toThrow();
    expect(() => assertReferralTransition("REWARD_PENDING", "PAID")).not.toThrow();
    expect(() => assertReferralTransition("ATTRIBUTED", "REJECTED")).not.toThrow();
    expect(() => assertReferralTransition("QUALIFIED", "REJECTED")).not.toThrow();
    expect(() => assertReferralTransition("REWARD_PENDING", "REJECTED")).not.toThrow();
  });

  it("throws on invalid transitions", () => {
    expect.assertions(3);
    expect(() => assertReferralTransition("PAID", "QUALIFIED")).toThrow();
    expect(() => assertReferralTransition("REJECTED", "ATTRIBUTED")).toThrow();
    expect(() => assertReferralTransition("PAID", "REWARD_PENDING")).toThrow();
  });
});

describe("linkForReferrer", () => {
  it("issues stable code and builds deep link", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8800n });
    const result = engine.linkForReferrer({
      campaignId: "test-camp-123",
      referrerUserId: creator.id,
      publicId: "public1234567890abcdef",
      referralCode: "abc12345",
      botUsername: "sparkbot",
      appName: "app",
    });
    expect(result).toEqual({
      startapp: "c_public1234567890abcdef_abc12345",
      deepLink: "https://t.me/sparkbot/app?startapp=c_public1234567890abcdef_abc12345",
      referralCode: "abc12345",
    });
  });
});

describe("attribute", () => {
  it("is first-wins idempotent and rejects self-referral", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8800n });
    const referred = await upsertUserByTelegramId(db, { telegramUserId: 8801n });
    const campaign = await createCampaign(db, {
      publicId: "attribtest000000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });

    const first = await engine.attribute({
      campaignId: campaign.id,
      referrerUserId: creator.id,
      referredUserId: referred.id,
      referralCode: "testcode1",
    });
    expect(first?.status).toBe("ATTRIBUTED");

    const again = await engine.attribute({
      campaignId: campaign.id,
      referrerUserId: creator.id,
      referredUserId: referred.id,
      referralCode: "testcode1",
    });
    expect(again?.id).toBe(first?.id);

    const self = await engine.attribute({
      campaignId: campaign.id,
      referrerUserId: creator.id,
      referredUserId: creator.id,
      referralCode: "testcode1",
    });
    expect(self).toBeNull();
  });

  it("ignores unknown code for qualification", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8802n });
    const referred = await upsertUserByTelegramId(db, { telegramUserId: 8803n });
    const campaign = await createCampaign(db, {
      publicId: "igncodetest000000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });

    await engine.attribute({
      campaignId: campaign.id,
      referrerUserId: creator.id,
      referredUserId: referred.id,
      referralCode: "testcode2",
    });

    await engine.qualify(campaign.id, referred.id);
    const referral = await (await import("@spark/db")).findReferral(db, campaign.id, referred.id);
    expect(referral?.status).toBe("QUALIFIED");
  });
});

describe("getOrCreateReferralCode", () => {
  it("is idempotent: same referrer + same generator returns same code", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8804n });
    const campaign = await createCampaign(db, {
      publicId: "idempotencytest000000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });

    const code1 = await engine.getOrCreateReferralCode(db, {
      campaignId: campaign.id,
      referrerUserId: creator.id,
      generate: () => "codeA1b2c3",
    });

    const code2 = await engine.getOrCreateReferralCode(db, {
      campaignId: campaign.id,
      referrerUserId: creator.id,
      generate: () => "codeX9y8z7",
    });

    expect(code2).toBe(code1);
    expect(code1).toBe("codeA1b2c3");
  });

  it("retries on code collision with same referrer", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8805n });
    const campaign = await createCampaign(db, {
      publicId: "collisiontest000000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });

    const code1 = await engine.getOrCreateReferralCode(db, {
      campaignId: campaign.id,
      referrerUserId: creator.id,
      generate: () => "shared-code",
    });

    const code2 = await engine.getOrCreateReferralCode(db, {
      campaignId: campaign.id,
      referrerUserId: creator.id,
      generate: () => "shared-code",
    });

    expect(code2).toBe(code1);
  });
});

describe("findReferrerByCode", () => {
  it("finds referrer by code", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 8807n });
    const campaign = await createCampaign(db, {
      publicId: "findcodetest000000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });

    await engine.getOrCreateReferralCode(db, {
      campaignId: campaign.id,
      referrerUserId: creator.id,
      generate: () => "findme001",
    });

    const found = await engine.findReferrerByCode(db, campaign.id, "findme001");
    expect(found?.id).toBe(creator.id);

    const notFound = await engine.findReferrerByCode(db, campaign.id, "nope0000");
    expect(notFound).toBeNull();
  });
});
