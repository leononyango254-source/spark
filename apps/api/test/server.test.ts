import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { buildServer } from "../src/server";

describe("api", () => {
  const app = buildServer();
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
  });
});
