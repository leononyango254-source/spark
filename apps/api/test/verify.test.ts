import type { CampaignRow, UserRow } from "@spark/db";
import { signInitData, TelegramBotClient } from "@spark/telegram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../../packages/db/test/harness";
import { createMembershipCache } from "../src/cache/membershipCache";
import { type ApiDeps, buildServer } from "../src/server";

const BOT_TOKEN = "123456:TEST_BOT_TOKEN";
let h: Harness;
let deps: ApiDeps;
let campaign: CampaignRow;
let user: UserRow;

beforeAll(async () => {
  h = await startHarness();
  const telegram = new TelegramBotClient({ botToken: BOT_TOKEN });
  deps = {
    db: h.db,
    telegram,
    membershipCache: createMembershipCache(300_000),
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
  };

  const { createCampaign, upsertUserByTelegramId } = await import("@spark/db");

  user = await upsertUserByTelegramId(h.db, {
    telegramUserId: 4242n,
    username: "alice",
    firstName: "Alice",
    lastName: null,
  });

  campaign = await createCampaign(h.db, {
    creatorId: user.id,
    chainId: 1,
    rewardMicroUsdc: 1_000_000n,
    referralRewardMicroUsdc: 100_000n,
    budgetMicroUsdc: 10_000_000n,
    balanceMicroUsdc: 10_000_000n,
    targetChatId: -1001234567890n,
    status: "ACTIVE",
    publicId: "testcampaign123",
  });

  await h.pool.query(
    `insert into tasks (campaign_id, type, reward_micro_usdc, config)
     values ($1, 'TELEGRAM_CHANNEL_MEMBERSHIP', $2, $3)`,
    [campaign.id, 1_000_000n, JSON.stringify({ chat_id: "-1001234567890" })],
  );
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

function freshInitData(now: number): string {
  return signInitData(
    {
      auth_date: String(now),
      query_id: "AAF",
      user: JSON.stringify({ id: 4242, first_name: "Alice", username: "alice" }),
    },
    BOT_TOKEN,
  );
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(app: ReturnType<typeof buildServer>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: freshInitData(Math.floor(Date.now() / 1000)) },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

describe("verify route", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.publicId}/verify`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated" });
    await app.close();
  });

  it("returns 404 for unknown campaign publicId", async () => {
    const app = buildServer(deps);
    const token = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/campaigns/unknown123/verify",
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
    await app.close();
  });

  it("returns 503 when telegram bot not configured", async () => {
    const appWithTelegram = buildServer(deps);
    const token = await login(appWithTelegram);
    await appWithTelegram.close();

    const noTelegramDeps: ApiDeps = {
      ...deps,
      telegram: undefined,
    };
    const app = buildServer(noTelegramDeps);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.publicId}/verify`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "telegram_not_configured" });
    await app.close();
  });

  it("returns 409 with telegram_error on telegram error", async () => {
    const app = buildServer(deps);
    const token = await login(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.publicId}/verify`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; reason: string; campaignId: string };
    expect(body.error).toBe("telegram_error");
    expect(body.reason).toMatch(/^telegram_/);
    expect(body.campaignId).toBe(campaign.publicId);
    await app.close();
  });

  it("cached hit returns verified with campaignId and cached: true", async () => {
    const fixedNow = Date.now();
    const cache = createMembershipCache(300_000, () => fixedNow);
    cache.set(`${campaign.id}:4242`, {
      verified: true,
      memberStatus: "member",
      expiresAt: fixedNow + 300_000,
    });

    const app = buildServer({
      ...deps,
      membershipCache: cache,
    });
    const token = await login(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.publicId}/verify`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verified: boolean;
      memberStatus: string;
      campaignId: string;
      cached: boolean;
    };
    expect(body.verified).toBe(true);
    expect(body.memberStatus).toBe("member");
    expect(body.campaignId).toBe(campaign.publicId);
    expect(body.cached).toBe(true);
    await app.close();
  });

  it("force=true bypasses cache for kicked user", async () => {
    const cache = createMembershipCache(300_000);
    const now = Date.now();
    cache.set(`${campaign.id}:4242`, {
      verified: false,
      memberStatus: "left",
      expiresAt: now + 300_000,
    });

    const app = buildServer({
      ...deps,
      membershipCache: cache,
    });
    const token = await login(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.publicId}/verify?force=1`,
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; reason: string; campaignId: string };
    expect(body.error).toBe("telegram_error");
    expect(body.reason).toMatch(/^telegram_/);
    expect(body.campaignId).toBe(campaign.publicId);
    await app.close();
  });
});
