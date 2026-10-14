import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export interface AdminRouteDeps {
  runner: { runOnce: () => Promise<unknown> };
  adminToken: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  app.post("/api/admin/settle", async (request, reply) => {
    const token = request.headers["x-admin-token"];
    if (typeof token !== "string" || !safeEqual(token, deps.adminToken)) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const stats = await deps.runner.runOnce();
    return reply.send({ status: "ok", stats });
  });
}
