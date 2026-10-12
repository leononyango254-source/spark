import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCampaign,
  createSession,
  findActiveSessionByTokenHash,
  findCampaignByPublicId,
  findUserById,
  revokeSession,
  upsertUserByTelegramId,
} from "../src";
import { type Harness, startHarness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("repositories", () => {
  it("upserts a user idempotently by telegram id", async () => {
    const first = await upsertUserByTelegramId(h.db, { telegramUserId: 8001n, username: "a" });
    const second = await upsertUserByTelegramId(h.db, { telegramUserId: 8001n, username: "b" });
    expect(second.id).toBe(first.id);
    expect(second.username).toBe("b");
    expect((await findUserById(h.db, first.id))?.username).toBe("b");
  });

  it("creates and resolves active sessions, honoring revocation", async () => {
    const user = await upsertUserByTelegramId(h.db, { telegramUserId: 8002n });
    const s = await createSession(h.db, {
      userId: user.id,
      tokenHash: "hash-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await findActiveSessionByTokenHash(h.db, "hash-1")).not.toBeNull();
    await revokeSession(h.db, s.id);
    expect(await findActiveSessionByTokenHash(h.db, "hash-1")).toBeNull();
  });

  it("creates a campaign and finds it by public id", async () => {
    const creator = await upsertUserByTelegramId(h.db, { telegramUserId: 8003n });
    const created = await createCampaign(h.db, {
      publicId: "pub-camp-1",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 25_000_000n,
      balanceMicroUsdc: 0n,
    });
    const found = await findCampaignByPublicId(h.db, "pub-camp-1");
    expect(found?.id).toBe(created.id);
    expect(found?.rewardMicroUsdc).toBe(100_000n);
  });

  it("drives campaign lifecycle and reserves budget atomically", async () => {
    const {
      createCampaign,
      findCampaignById,
      setCampaignFunded,
      updateCampaignStatus,
      reserveCampaignBudget,
      updateCampaignConfig,
      incrementParticipantCount,
    } = await import("../src");
    const creator = await upsertUserByTelegramId(h.db, { telegramUserId: 8100n });
    const c = await createCampaign(h.db, {
      publicId: "publife00000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
      maxParticipants: 5,
    });
    expect((await findCampaignById(h.db, c.id))?.status).toBe("DRAFT");

    const configured = await updateCampaignConfig(h.db, c.id, { rewardMicroUsdc: 120_000n });
    expect(configured.rewardMicroUsdc).toBe(120_000n);

    await updateCampaignStatus(h.db, c.id, "FUNDING");
    await setCampaignFunded(h.db, c.id, 1_000_000n);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(1_000_000n);

    expect(await reserveCampaignBudget(h.db, c.id, 100_000n)).toBe(true);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(900_000n);
    expect(await reserveCampaignBudget(h.db, c.id, 10_000_000n)).toBe(false);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(900_000n);

    expect(await incrementParticipantCount(h.db, c.id)).toBe(true);
    expect((await findCampaignById(h.db, c.id))?.participantCount).toBe(1);
  });

  it("creates a membership task and finds it", async () => {
    const { createCampaign, createMembershipTask, findMembershipTask } = await import("../src");
    const creator = await upsertUserByTelegramId(h.db, { telegramUserId: 8101n });
    const c = await createCampaign(h.db, {
      publicId: "pubtask00000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-100999",
    });
    const task = await findMembershipTask(h.db, c.id);
    expect(task?.rewardMicroUsdc).toBe(100_000n);
    expect(((task?.config ?? {}) as { chat_id?: string }).chat_id).toBe("-100999");
  });

  it("creates a participation, freezes the referrer, and advances status", async () => {
    const {
      createCampaign,
      createMembershipTask,
      createParticipation,
      findParticipation,
      updateParticipationStatus,
      setParticipationReferrer,
    } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8200n });
    const b = await upsertUserByTelegramId(h.db, { telegramUserId: 8201n });
    const c = await createCampaign(h.db, {
      publicId: "pubpart00000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const task = await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1001",
    });
    const p = await createParticipation(h.db, { campaignId: c.id, userId: b.id, taskId: task.id });
    expect(p.status).toBe("STARTED");

    await setParticipationReferrer(h.db, p.id, { referrerUserId: a.id, referralCode: "abc12345" });
    const found = await findParticipation(h.db, c.id, b.id);
    expect(found?.referrerUserId).toBe(a.id);
    expect(found?.referralCodeUsed).toBe("abc12345");

    const verified = await updateParticipationStatus(h.db, p.id, "VERIFIED", {
      verifiedAt: new Date(),
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedAt).not.toBeNull();
  });

  it("attributes referrals first-wins and advances lifecycle", async () => {
    const { createCampaign, upsertReferralAttribution, findReferral, updateReferralStatus } =
      await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8300n });
    const b = await upsertUserByTelegramId(h.db, { telegramUserId: 8301n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const first = await upsertReferralAttribution(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      referredUserId: b.id,
      referralCode: "code0001",
    });
    expect(first?.status).toBe("ATTRIBUTED");

    const again = await upsertReferralAttribution(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      referredUserId: b.id,
      referralCode: "code0001",
    });
    expect(again?.id).toBe(first?.id);

    const qualified = await updateReferralStatus(h.db, first!.id, "QUALIFIED", {
      qualifiedAt: new Date(),
    });
    expect(qualified.status).toBe("QUALIFIED");
    expect((await findReferral(h.db, c.id, b.id))?.qualifiedAt).not.toBeNull();
  });

  it("returns null for self-referral", async () => {
    const { createCampaign, upsertReferralAttribution } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8302n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000002",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    expect(
      await upsertReferralAttribution(h.db, {
        campaignId: c.id,
        referrerUserId: a.id,
        referredUserId: a.id,
        referralCode: "self0001",
      }),
    ).toBeNull();
  });

  it("issues one referral code per referrer and resolves referrer by code", async () => {
    const { createCampaign, getOrCreateReferralCode, findReferrerByCode } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8303n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000003",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const code1 = await getOrCreateReferralCode(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      generate: () => "code0007",
    });
    const code2 = await getOrCreateReferralCode(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      generate: () => "code9999",
    });
    expect(code2).toBe(code1);
    expect(code1).toBe("code0007");
    expect((await findReferrerByCode(h.db, c.id, "code0007"))?.id).toBe(a.id);
    expect(await findReferrerByCode(h.db, c.id, "nope1234")).toBeNull();
  });

  it("creates rewards, lists settleable ones, and advances status", async () => {
    const {
      createCampaign,
      createMembershipTask,
      createParticipation,
      createReward,
      listSettleableRewards,
      updateRewardStatus,
      nextRewardNonce,
      findRewardByType,
      countRewardsByStatus,
    } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8400n });
    const c = await createCampaign(h.db, {
      publicId: "pubrw000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    const task = await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1002",
    });
    const p = await createParticipation(h.db, { campaignId: c.id, userId: a.id, taskId: task.id });

    const nonce = await nextRewardNonce(h.db);
    const reward = await createReward(h.db, {
      campaignId: c.id,
      participationId: p.id,
      rewardType: "USER_COMPLETION",
      recipientUserId: a.id,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
      authorizationNonce: nonce,
      authorizationExpiresAt: new Date(Date.now() + 3_600_000),
      status: "AUTHORIZED",
      chainId: 5042002,
    });
    expect(reward.status).toBe("AUTHORIZED");
    expect((await findRewardByType(h.db, c.id, p.id, "USER_COMPLETION"))?.id).toBe(reward.id);
    expect((await countRewardsByStatus(h.db, c.id)).AUTHORIZED).toBe(1);

    expect((await listSettleableRewards(h.db, 10)).map((r) => r.id)).toContain(reward.id);
    const paid = await updateRewardStatus(h.db, reward.id, "PAID", { confirmedAt: new Date() });
    expect(paid.status).toBe("PAID");
    expect((await listSettleableRewards(h.db, 10)).map((r) => r.id)).not.toContain(reward.id);
  });

  it("appends ledger entries idempotently", async () => {
    const { createCampaign, appendLedgerEntry, findLedgerEntryByIdempotencyKey } = await import(
      "../src"
    );
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8500n });
    const c = await createCampaign(h.db, {
      publicId: "publ3d000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    await appendLedgerEntry(h.db, {
      campaignId: c.id,
      entryType: "CAMPAIGN_FUNDING",
      amountMicroUsdc: 1_000_000n,
      direction: 1,
      idempotencyKey: `funding:${c.id}`,
    });
    await appendLedgerEntry(h.db, {
      campaignId: c.id,
      entryType: "CAMPAIGN_FUNDING",
      amountMicroUsdc: 1_000_000n,
      direction: 1,
      idempotencyKey: `funding:${c.id}`,
    });
    const row = await findLedgerEntryByIdempotencyKey(h.db, `funding:${c.id}`);
    expect(row?.amountMicroUsdc).toBe(1_000_000n);
    expect(row?.direction).toBe(1);
  });
});
