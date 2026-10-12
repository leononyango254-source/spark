import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";
import { createCampaignEngine } from "@spark/campaign";

const createCampaignBody = z.object({
  creatorId: z.string().min(1),
  chainId: z.number().int(),
  rewardMicroUsdc: z.string(),
  referralRewardMicroUsdc: z.string(),
  budgetMicroUsdc: z.string(),
  maxParticipants: z.number().int().optional(),
  targetChatId: z.string().optional(),
  targetChatUsername: z.string().optional(),
});

const fundCampaignBody = z.object({
  amountMicroUsdc: z.string(),
});

const toBigInt = (str: string): bigint => BigInt(str);

export function registerCampaignRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post("/api/campaigns", async (request, reply) => {
    const parsed = createCampaignBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const campaignEngine = deps.campaignEngine as ReturnType<typeof createCampaignEngine>;
    const created = await campaignEngine.createCampaign({
      creatorId: parsed.data.creatorId,
      chainId: parsed.data.chainId,
      rewardMicroUsdc: toBigInt(parsed.data.rewardMicroUsdc),
      referralRewardMicroUsdc: toBigInt(parsed.data.referralRewardMicroUsdc),
      budgetMicroUsdc: toBigInt(parsed.data.budgetMicroUsdc),
      maxParticipants: parsed.data.maxParticipants ? Number(parsed.data.maxParticipants) : undefined,
      targetChatId: parsed.data.targetChatId ? BigInt(parsed.data.targetChatId) : undefined,
      targetChatUsername: parsed.data.targetChatUsername,
    });
    return reply.send({
      id: created.id,
      publicId: created.publicId,
      status: created.status,
    });
  });

  app.post("/api/campaigns/:publicId/fund", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { publicId } = request.params as { publicId: string };
    const parsed = fundCampaignBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const updated = await deps.campaignEngine!.fundCampaign(
      publicId,
      toBigInt(parsed.data.amountMicroUsdc),
    );
    return reply.send({ id: updated.id, status: updated.status });
  });

  app.post("/api/campaigns/:publicId/activate", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { publicId } = request.params as { publicId: string };
    const activated = await deps.campaignEngine!.activateCampaign(publicId);
    return reply.send({ id: activated.id, status: activated.status });
  });

  app.get("/api/campaigns/:publicId/stats", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { publicId } = request.params as { publicId: string };
    const stats = await deps.campaignEngine!.getCampaignStats(publicId);
    return reply.send(stats);
  });

  app.get("/api/campaigns/stats", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const firstCampaign = await deps.campaignEngine!.getCampaignStats("1");
    return reply.send(firstCampaign);
  });
}