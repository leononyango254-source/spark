import { afterEach, describe, expect, it } from "vitest";
import { createCampaignEngine } from "@spark/campaign";
import { createMembershipCache } from "../src/cache/membershipCache";
import { loadEnv } from "../src/env";
import { buildServer } from "../src/server";

function testDeps() {
  const env = loadEnv({} as NodeJS.ProcessEnv);
  const db = {} as any;
  const campaignEngine = createCampaignEngine({ db });
  const membershipCache = createMembershipCache(env.MEMBERSHIP_CACHE_TTL_MS);

  return {
    db,
    telegram: undefined,
    membershipCache,
    sessionTtlSeconds: env.SESSION_TTL_SECONDS,
    nodeEnv: env.NODE_ENV,
  };
}

describe("campaign routes", () => {
  const app = buildServer(testDeps());

  afterEach(async () => {
    await app.close();
  });

  it("returns 401 without a session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/stats",
    });
    expect(res.statusCode).toBe(401);
  });
});