import {
  createCampaign,
  type Db,
  findActiveWalletByCampaignAndUser,
  upsertUserByTelegramId,
} from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { associateWallet } from "../src/scripts/associate-wallet";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("associateWallet", () => {
  it("creates the user if missing and stores a normalized association", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 9811n });
    const campaign = await createCampaign(db, {
      publicId: "assocwallet00001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });

    await associateWallet(db, {
      campaignId: campaign.id,
      telegramUserId: 9812n,
      address: "0xAbC0000000000000000000000000000000000001",
    });

    const user = await upsertUserByTelegramId(db, { telegramUserId: 9812n });
    const assoc = await findActiveWalletByCampaignAndUser(db, campaign.id, user.id);
    expect(assoc?.normalizedAddress).toBe("0xabc0000000000000000000000000000000000001");
  });

  it("updates the association when called again for the same campaign/user", async () => {
    const creator = await upsertUserByTelegramId(db, { telegramUserId: 9821n });
    const campaign = await createCampaign(db, {
      publicId: "assocwallet00002",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });

    await associateWallet(db, {
      campaignId: campaign.id,
      telegramUserId: 9822n,
      address: "0x00000000000000000000000000000000000000AA",
    });
    await associateWallet(db, {
      campaignId: campaign.id,
      telegramUserId: 9822n,
      address: "0xDef0000000000000000000000000000000000002",
    });

    const user = await upsertUserByTelegramId(db, { telegramUserId: 9822n });
    const assoc = await findActiveWalletByCampaignAndUser(db, campaign.id, user.id);
    expect(assoc?.normalizedAddress).toBe("0xdef0000000000000000000000000000000000002");
  });
});
