import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { signInitData, TelegramBotClient } from "@spark/telegram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../../packages/db/test/harness";
import { createMembershipCache } from "../src/cache/membershipCache";
import { type ApiDeps, buildServer } from "../src/server";

const BOT_TOKEN = "123456:TEST_BOT_TOKEN";
let h: Harness;
let deps: ApiDeps;

beforeAll(async () => {
  h = await startHarness();
  deps = {
    db: h.db,
    telegram: new TelegramBotClient({ botToken: BOT_TOKEN }),
    membershipCache: createMembershipCache(300_000),
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    campaignEngine: createCampaignEngine({ db: h.db }),
    referralEngine: createReferralEngine({ db: h.db }),
    rewardEngine: createRewardEngine({ db: h.db }),
    botUsername: "sparkbot",
    appName: "app",
  };
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

describe("auth", () => {
  it("rejects a missing/invalid body", async () => {
    const app = buildServer(deps);
    const res = await app.inject({ method: "POST", url: "/api/auth/telegram", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects tampered initData", async () => {
    const app = buildServer(deps);
    const bad = freshInitData(Math.floor(Date.now() / 1000)).replace("alice", "mallory");
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: bad },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("authenticates valid initData and returns an opaque session", async () => {
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData: freshInitData(Math.floor(Date.now() / 1000)) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: { telegramUserId: string } };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.user.telegramUserId).toBe("4242");

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { username: string }).username).toBe("alice");
    await app.close();
  });

  it("rejects unauthenticated /api/me", async () => {
    const app = buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("attributes referral when campaignPublicId and referralCode provided", async () => {
    const app = buildServer(deps);
    const referralCode = "a1b2c3d4";
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: {
        initData: freshInitData(Math.floor(Date.now() / 1000)),
        campaignPublicId: "testcampaign1234",
        referralCode,
      },
    });
    expect(res.statusCode).toBe(200);
    const token = (res.json() as { token: string }).token;
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    await app.close();
  });
});
