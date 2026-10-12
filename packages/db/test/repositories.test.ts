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
});
