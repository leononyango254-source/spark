import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAdminRoutes } from "../src/routes/admin";

async function build(runnerRunOnce: () => Promise<unknown>) {
  const app = Fastify();
  registerAdminRoutes(app, { runner: { runOnce: runnerRunOnce }, adminToken: "secret" });
  await app.ready();
  return app;
}

describe("POST /api/admin/settle", () => {
  it("returns 401 without a token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({ method: "POST", url: "/api/admin/settle" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with the wrong token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with a wrong-length token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "short" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with an empty token", async () => {
    const app = await build(async () => ({}));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the cycle stats with the right token", async () => {
    const app = await build(async () => ({ submitted: 2, confirmed: 2 }));
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/settle",
      headers: { "x-admin-token": "secret" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", stats: { submitted: 2, confirmed: 2 } });
  });
});
