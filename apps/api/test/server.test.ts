import type { Db } from "@spark/db";
import { TelegramBotClient } from "@spark/telegram";
import { afterEach, describe, expect, it } from "vitest";
import { createMembershipCache } from "../src/cache/membershipCache";
import { loadEnv } from "../src/env";
import { buildServer } from "../src/server";

function testDeps(): Parameters<typeof buildServer>[0] {
  return {
    db: {} as Db,
    telegram: new TelegramBotClient({ botToken: "123456:TEST" }),
    membershipCache: createMembershipCache(300_000),
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
  };
}

describe("api", () => {
  const app = buildServer(testDeps());
  afterEach(async () => {
    await app.close();
  });

  it("responds to /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "spark-api" });
  });

  it("parses env with defaults", () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.ARC_NETWORK).toBe("testnet");
    expect(env.SESSION_TTL_SECONDS).toBe(2_592_000);
  });
});
