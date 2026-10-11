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
});
