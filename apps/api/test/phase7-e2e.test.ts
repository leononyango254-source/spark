import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCampaignEngine } from "@spark/campaign";
import { type Db, users } from "@spark/db";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { createSettlementService } from "@spark/settlement";
import { signInitData } from "@spark/telegram";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { startHarness, type Harness } from "../../../packages/db/test/harness";
import { buildServer } from "../src/server";

const BOT_TOKEN = "123456:TEST";

describe("Phase 7: Wallet → Settlement e2e", () => {
  let h: Harness;
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  let creatorToken: string;
  let userId: string;
  let campaignId: string;

  beforeAll(async () => {
    h = await startHarness();
    db = h.db;

    // Create a test user via harness
    const [user] = await db
      .insert(users)
      .values({
        telegramUserId: 9100n,
        username: "testuser",
        firstName: "Test",
        lastName: "User",
      })
      .returning();
    if (!user) throw new Error("failed to create test user");
    userId = user.id;

    // Build the server with deps
    app = buildServer({
      db,
      telegram: {
        botToken: BOT_TOKEN,
        getChatMember: async () => ({ status: "member" }),
        getChatAdministrators: async () => [],
        sendMessage: async () => {},
        getMe: async () => ({ id: 1, username: "test_bot" }),
        getUpdates: async () => [],
      } as never,
      membershipCache: { get: vi.fn(), set: vi.fn() } as never,
      campaignEngine: createCampaignEngine({ db }),
      referralEngine: createReferralEngine({ db }),
      rewardEngine: createRewardEngine({ db }),
      sessionTtlSeconds: 3600,
      nodeEnv: "test",
      botUsername: "testbot",
      appName: "test",
      walletConnect: {
        createSession: async () => ({
          sessionId: "wc-sess-1",
          uri: "wc:test-uri@2?project=test",
          topic: "wc-topic-1",
        }),
        getApproved: async () => ({
          address: "0x00000000000000000000000000000000000000A1",
          chainId: 5042002,
          topic: "wc-topic-1",
        }),
        disconnect: async () => {},
      } as unknown as WalletConnectSessionManager,
      settlement: createSettlementService({
        projectId: "test-wc-project",
        chainId: 5042002,
      }),
    } as never);

    // Login as the test user
    const authRes = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: {
        initData: signInitData(
          {
            auth_date: String(Math.floor(Date.now() / 1000)),
            query_id: "AAF",
            user: JSON.stringify({ id: 9100, username: "testuser" }),
          },
          BOT_TOKEN,
        ),
      },
    });
    expect(authRes.statusCode).toBe(200);
    creatorToken = (authRes.json() as { token: string }).token;

    // Create a campaign
    const campRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers: { authorization: `Bearer ${creatorToken}` },
      payload: {
        creatorId: userId,
        chainId: 5042002,
        rewardMicroUsdc: "1000",
        referralRewardMicroUsdc: "100",
        budgetMicroUsdc: "100000",
        maxParticipants: 10,
        targetChatId: "-1001234567890",
      },
    });
    const campBody = await campRes.json();
    campaignId = campBody.id;

    // Set up wallet association for the user
    await h.pool.query(
      `insert into wallet_associations (campaign_id, user_id, address, normalized_address)
       values ($1, $2, $3, $3)`,
      [campaignId, userId, "0x0000000000000000000000000000000000000000"],
    );
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  it("full wallet connect → submit settlement → poll status flow", async () => {
    // Step 1: Connect wallet (Phase 6 flow)
    const connectRes = await app.inject({
      method: "POST",
      url: "/api/wallet/connect",
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(connectRes.statusCode).toBe(200);
    const connectBody = connectRes.json();
    expect(connectBody.sessionId).toBeDefined();
    expect(connectBody.uri).toContain("wc:");

    // Step 2: Poll until connected (simulate user approving WC)
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/wallet/connect/${connectBody.sessionId}`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(statusRes.statusCode).toBe(200);

    // Step 3: Submit settlement
    const submitRes = await app.inject({
      method: "POST",
      url: "/api/settlement/submit",
      headers: { authorization: `Bearer ${creatorToken}` },
      payload: {
        amount: "100",
        chainId: 5042002,
        address: "0x00000000000000000000000000000000000000A1",
      },
    });
    expect(submitRes.statusCode).toBe(200);
    const submitBody = submitRes.json();
    expect(submitBody.status).toBe("submitted");
    expect(submitBody.txHash).toBeDefined();
    const txHash = submitBody.txHash;

    // Step 4: Poll settlement status
    const statusCheck = await app.inject({
      method: "GET",
      url: `/api/settlement/status/${txHash}`,
      headers: { authorization: `Bearer ${creatorToken}` },
    });
    expect(statusCheck.statusCode).toBe(200);

    // The mock settlement service should mark it as settled
    expect(statusCheck.json().status).toBe("settled");
  });
});
