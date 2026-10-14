import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";

function buildWithDist(distDir: string) {
  return buildServer({
    db: {} as never,
    telegram: undefined,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    botUsername: "testbot",
    appName: "app",
    webDistDir: distDir,
  } as never);
}

describe("mini app static serving", () => {
  it("serves index.html at / and falls back for SPA routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spark-dist-"));
    writeFileSync(join(dir, "index.html"), "<html><body>SPARK_MINI</body></html>");
    const app = buildWithDist(dir);

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("SPARK_MINI");

    const spa = await app.inject({ method: "GET", url: "/tx/0xabc" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("SPARK_MINI");
  });

  it("keeps unknown /api routes as JSON 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spark-dist-"));
    writeFileSync(join(dir, "index.html"), "SPARK_MINI");
    const app = buildWithDist(dir);
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });
});
