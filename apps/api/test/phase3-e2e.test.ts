import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { signInitData } from "@spark/telegram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../../packages/db/test/harness";
import { settleAuthorizedRewards } from "../../../worker/src/settlement";
import { createMembershipCache } from "../src/cache/membershipCache";
import type { ApiDeps } from "../src/server";
import { buildServer } from "../src/server";

const BOT_TOKEN = "123456:TEST";

describe("Phase 3 E2E", () => {
  let h: Harness;
  let deps: ApiDeps;
  let creatorToken: string;
  let referredToken: string;
  let campaignPublicId: string;
  let campaignId: string;
  let creatorId: string;
  let referredUserId: string;
  let referralCode: string;

  beforeAll(async () => {
    h = await startHarness();

    // Create creator user
    const creatorResult = await h.pool.query(
      `insert into users (telegram_user_id, username, first_name, last_name)
       values ($1, $2, $3, $4) returning id`,
      [12345n, "creator", "Creator", null],
    );
    creatorId = creatorResult.rows[0].id;

    // Create referred user
    const referredResult = await h.pool.query(
      `insert into users (telegram_user_id, username, first_name, last_name)
       values ($1, $2, $3, $4) returning id`,
      [54321n, "referred", "Referred", null],
    );
    referredUserId = referredResult.rows[0].id;

    const referralEngine = createReferralEngine({ db: h.db });
    const rewardEngine = createRewardEngine({ db: h.db });
    const membershipCache = createMembershipCache(300_000);

    // Mock Telegram bot API that returns member status
    const mockTelegram = {
      botToken: BOT_TOKEN,
      getChatMember: async (_chatId: bigint | string, telegramUserId: bigint) => ({
        status: "member",
        user: {
          id: Number(telegramUserId),
          is_bot: false,
          first_name: "User",
          last_name: null,
          username: "user",
        },
      }),
      getChatAdministrators: async () => [],
      sendMessage: async () => {},
      getMe: async () => ({ id: 1, username: "test_bot" }),
      getUpdates: async () => [],
    } as any;

    deps = {
      db: h.db,
      telegram: mockTelegram,
      membershipCache,
      sessionTtlSeconds: 3600,
      nodeEnv: "test",
      campaignEngine: createCampaignEngine({ db: h.db }),
      referralEngine,
      rewardEngine,
    };

    // Create the app and login as creator
    const app = buildServer(deps);
    creatorToken = await login(app, BOT_TOKEN, 12345n, "creator");

    // Create a campaign in DRAFT status (with targetChatId for membership task)
    const created = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers: { authorization: `Bearer ${creatorToken}` },
      payload: {
        creatorId,
        chainId: 1,
        rewardMicroUsdc: "1000000",
        referralRewardMicroUsdc: "100000",
        budgetMicroUsdc: "110000000",
        maxParticipants: 100,
        targetChatId: "-1001234567890",
      },
    });
    const campaign = await created.json();
    campaignId = campaign.id;
    campaignPublicId = campaign.publicId;
    expect(campaignPublicId).toBeDefined();

    // Fund the campaign (required minimum = (1_000_000 + 100_000) * 100 = 110_000_000)
    const fundRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignPublicId}/fund`,
      headers: { authorization: `Bearer ${creatorToken}` },
      payload: { amountMicroUsdc: "110000000" },
    });
    expect(fundRes.statusCode).toBe(200);

    // Activate the campaign
    const activateRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignPublicId}/activate`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(activateRes.statusCode).toBe(200);
    expect((await activateRes.json()).status).toBe("ACTIVE");

    // Creator gets referral link
    const referralLinkRes = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignPublicId}/referral-link`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(referralLinkRes.statusCode).toBe(200);
    referralCode = (await referralLinkRes.json()).referralCode;
    expect(referralCode).toBeDefined();

    // Referred user logs in with referral code
    referredToken = await login(app, BOT_TOKEN, 54321n, "referred", campaignPublicId, referralCode);
    await app.close();
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  async function login(
    app: ReturnType<typeof buildServer>,
    botToken: string,
    telegramUserId: bigint,
    username: string,
    campaignPublicId?: string,
    referralCode?: string,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const initData = signInitData(
      {
        auth_date: String(now),
        query_id: "AAF",
        user: JSON.stringify({ id: Number(telegramUserId), first_name: username, username }),
      },
      botToken,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData, campaignPublicId, referralCode },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { token: string }).token;
  }

  it("full Phase 3 flow: creator → fund → activate → referral attribution → verify → settle", async () => {
    const app = buildServer(deps);

    // 3. Assert referral row exists with status ATTRIBUTED
    const referralRows = await h.pool.query(
      `select * from referrals where campaign_id = $1 and referred_user_id = $2`,
      [campaignId, referredUserId],
    );
    expect(referralRows.rows.length).toBe(1);
    expect(referralRows.rows[0].status).toBe("ATTRIBUTED");
    expect(referralRows.rows[0].referral_code).toBe(referralCode);

    // 4. POST /api/campaigns/:publicId/verify (stub verifyChannelMembership via fake TelegramBotApi)
    const verifyResponse = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignPublicId}/verify`,
      headers: { authorization: `Bearer ${referredToken}` },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyBody = verifyResponse.json();
    expect(verifyBody.rewardsAuthorized).toBeGreaterThanOrEqual(2); // USER_COMPLETION + REFERRAL
    expect(verifyBody.verified).toBe(true);
    expect(verifyBody.memberStatus).toBe("member");

    // Check participation status is VERIFIED or REWARD_PENDING
    const participationRows = await h.pool.query(
      `select * from participations where campaign_id = $1 and user_id = $2`,
      [campaignId, referredUserId],
    );
    expect(participationRows.rows.length).toBe(1);
    const participation = participationRows.rows[0];
    expect(["VERIFIED", "REWARD_PENDING"]).toContain(participation.status);

    // Check reward rows are AUTHORIZED (user + referral)
    const rewardRows = await h.pool.query(
      `select * from rewards where campaign_id = $1 and status = 'AUTHORIZED'`,
      [campaignId],
    );
    expect(rewardRows.rows.length).toBe(2);
    const rewardTypes = rewardRows.rows.map((r: any) => r.reward_type).sort();
    expect(rewardTypes).toEqual(["REFERRAL", "USER_COMPLETION"]);

    // Check referral status is now QUALIFIED or REWARD_PENDING
    const referralAfterVerify = await h.pool.query(
      `select * from referrals where campaign_id = $1 and referred_user_id = $2`,
      [campaignId, referredUserId],
    );
    expect(["QUALIFIED", "REWARD_PENDING"]).toContain(referralAfterVerify.rows[0].status);

    // 5. Run settleAuthorizedRewards from worker
    const processed = await settleAuthorizedRewards({ db: h.db });
    expect(processed).toBe(2); // user + referral rewards

    // 6. Assert: user + referral rewards PAID
    const paidRewards = await h.pool.query(
      `select * from rewards where campaign_id = $1 and status = 'PAID'`,
      [campaignId],
    );
    expect(paidRewards.rows.length).toBe(2);
    const paidRewardTypes = paidRewards.rows.map((r: any) => r.reward_type).sort();
    expect(paidRewardTypes).toEqual(["REFERRAL", "USER_COMPLETION"]);

    // Referral row PAID
    const referralAfterSettle = await h.pool.query(
      `select * from referrals where campaign_id = $1 and referred_user_id = $2`,
      [campaignId, referredUserId],
    );
    expect(referralAfterSettle.rows[0].status).toBe("PAID");

    // ledger_entries contains one USER_REWARD and one REFERRAL_REWARD
    const ledgerEntries = await h.pool.query(
      `select * from ledger_entries where campaign_id = $1`,
      [campaignId],
    );
    expect(ledgerEntries.rows.length).toBe(2);
    const entryTypes = ledgerEntries.rows.map((r: any) => r.entry_type).sort();
    expect(entryTypes).toEqual(["REFERRAL_REWARD", "USER_REWARD"]);

    // Campaign balance reduced accordingly (1_000_000 + 100_000 = 1_100_000)
    const campaignRow = await h.pool.query(`select * from campaigns where id = $1`, [campaignId]);
    expect(BigInt(campaignRow.rows[0].balance_micro_usdc)).toBe(110_000_000n - 1_100_000n);

    await app.close();
  });
});
