import { type Db, findCampaignById, findMembershipTask, updateCampaignStatus, upsertUserByTelegramId } from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../db/test/harness";
import { createCampaignEngine } from "../src";
import { canTransitionCampaign } from "../src/state";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

async function creator(telegramId: number): Promise<string> {
  return (await upsertUserByTelegramId(db, { telegramUserId: BigInt(telegramId) })).id;
}

describe("campaign state machine", () => {
  it("allows the canonical lifecycle only", () => {
    expect(canTransitionCampaign("DRAFT", "FUNDING")).toBe(true);
    expect(canTransitionCampaign("FUNDING", "FUNDED")).toBe(true);
    expect(canTransitionCampaign("FUNDED", "ACTIVE")).toBe(true);
    expect(canTransitionCampaign("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionCampaign("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransitionCampaign("ACTIVE", "CLOSED")).toBe(true);
    expect(canTransitionCampaign("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionCampaign("CLOSED", "ACTIVE")).toBe(false);
  });
});

describe("CampaignEngine create", () => {
  it("creates a DRAFT campaign with a membership task", async () => {
    const engine = createCampaignEngine({ db });
    const created = await engine.createCampaign({
      creatorId: await creator(9001),
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      maxParticipants: 10,
      targetChatId: -1001234567890n,
    });
    expect(created.status).toBe("DRAFT");
    expect(created.publicId).toMatch(/^[0-9a-z]{16}$/);
    expect(created.maxParticipants).toBe(10);
    const task = await findMembershipTask(db, created.id);
    expect((task?.config as { chat_id?: string }).chat_id).toBe("-1001234567890");
  });

  it("rejects config updates after leaving DRAFT", async () => {
    const engine = createCampaignEngine({ db });
    const created = await engine.createCampaign({
      creatorId: await creator(9002),
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
    });
    await updateCampaignStatus(db, created.id, "FUNDING");
    await expect(engine.updateConfig(created.id, { rewardMicroUsdc: 200_000n })).rejects.toThrow(
      /not draft/i,
    );
    expect((await findCampaignById(db, created.id))?.rewardMicroUsdc).toBe(100_000n);
  });
});