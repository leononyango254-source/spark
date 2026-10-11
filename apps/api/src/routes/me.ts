import type { FastifyInstance } from "fastify";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

export function registerMeRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get("/api/me", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return reply.send({
      id: user.id,
      telegramUserId: user.telegramUserId.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  });
}
