import type { FastifyInstance } from "fastify";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

export function registerWalletRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const walletConnect = deps.walletConnect;
  if (!walletConnect) return;
  const wc = walletConnect;
  app.post("/api/wallet/connect", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const session = await wc.createSession();
    return reply.send({ sessionId: session.sessionId, uri: session.uri });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/wallet/connect/:sessionId",
    async (request, reply) => {
      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });
      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      const { sessionId } = request.params;
      const approved = wc.getApproved(sessionId);
      if (approved) {
        return reply.send({ status: "connected", address: approved.address, chainId: approved.chainId });
      }
      return reply.send({ status: "pending" });
    },
  );

  app.post("/api/wallet/disconnect", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { sessionId } = request.body as { sessionId?: string };
    if (!sessionId) return reply.code(400).send({ error: "invalid_body" });

    await wc.disconnect(sessionId);
    return reply.send({ success: true });
  });
}
