import type { Db } from "@spark/db";
import type { FastifyInstance } from "fastify";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

export interface SettlementRouteDeps {
  db: Db;
  walletConnect: WalletConnectSessionManager;
  settlement: any;
}

export function registerSettlementRoutes(app: FastifyInstance, deps: ApiDeps & SettlementRouteDeps): void {
  app.post("/api/settlement/submit", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { address, amount, chainId } = request.body as { address: string; amount: string; chainId: number };
    if (!address || !amount || !chainId) return reply.code(400).send({ error: "invalid_body" });

    const result = await deps.settlement.submitSettlement(
      address,
      BigInt(amount),
      chainId,
      deps.walletConnect
    );
    return reply.send({ status: "submitted", txHash: result.hash });
  });

  app.get<{ Params: { txHash: string } }>(
    "/api/settlement/status/:txHash",
    async (request, reply) => {
      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });
      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      const { txHash } = request.params;
      const status = await deps.settlement.getSettlementStatus(txHash);
      return reply.send({ status: status.status, ...(status.receipt && { receipt: status.receipt }) });
    });
}