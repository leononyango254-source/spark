import type { createCampaignEngine } from "@spark/campaign";
import { findCampaignByPublicId } from "@spark/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";
import { eq } from "drizzle-orm";
import { campaigns } from "@spark/db";

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
    const createInput: {
      creatorId: string;
      chainId: number;
      rewardMicroUsdc: bigint;
      referralRewardMicroUsdc: bigint;
      budgetMicroUsdc: bigint;
      maxParticipants?: number;
      targetChatId?: bigint;
      targetChatUsername?: string;
    } = {
      creatorId: parsed.data.creatorId,
      chainId: parsed.data.chainId,
      rewardMicroUsdc: toBigInt(parsed.data.rewardMicroUsdc),
      referralRewardMicroUsdc: toBigInt(parsed.data.referralRewardMicroUsdc),
      budgetMicroUsdc: toBigInt(parsed.data.budgetMicroUsdc),
    };
    if (parsed.data.maxParticipants !== undefined) {
      createInput.maxParticipants = Number(parsed.data.maxParticipants);
    }
    if (parsed.data.targetChatId !== undefined) {
      createInput.targetChatId = BigInt(parsed.data.targetChatId);
    }
    if (parsed.data.targetChatUsername !== undefined) {
      createInput.targetChatUsername = parsed.data.targetChatUsername;
    }
    const created = await campaignEngine.createCampaign(createInput);
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

    const campaign = await findCampaignByPublicId(deps.db, publicId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    const updated = await deps.campaignEngine?.fundCampaign(
      campaign.id,
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

    const campaign = await findCampaignByPublicId(deps.db, publicId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    const activated = await deps.campaignEngine?.activateCampaign(campaign.id);
    return reply.send({ id: activated.id, status: activated.status });
  });

  app.get<{ Params: { publicId: string } }>(
    "/api/campaigns/:publicId/referral-link",
    async (request, reply) => {
      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });
      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
      if (!campaign) return reply.code(404).send({ error: "not_found" });

      const referralCode = await deps.referralEngine.getOrCreateReferralCode(deps.db, {
        campaignId: campaign.id,
        referrerUserId: user.id,
        generate: () => Math.random().toString(36).substring(2, 10),
      });

      const link = deps.referralEngine.linkForReferrer({
        campaignId: campaign.id,
        referrerUserId: user.id,
        publicId: campaign.publicId,
        referralCode,
        botUsername: deps.botUsername,
        appName: deps.appName,
      });

      return reply.send(link);
    },
  );

  app.get("/api/campaigns/:publicId/stats", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { publicId } = request.params as { publicId: string };
    const campaign = await findCampaignByPublicId(deps.db, publicId);
    if (!campaign) return reply.code(404).send({ error: "not_found" });

    const stats = await deps.campaignEngine?.getCampaignStats(campaign.id);
    return reply.send(stats);
  });

  app.get("/api/campaigns/stats", async (request, reply) => {
    const token = extractToken(request.headers);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const user = await resolveSession(deps.db, token);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    // Return stats for all campaigns created by the user
    const userCampaigns = await deps.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.creatorId, user.id));

    const stats = await Promise.all(
      userCampaigns.map(async (campaign) => {
        const stats = await deps.campaignEngine?.getCampaignStats(campaign.id);
        return { publicId: campaign.publicId, ...stats };
      }),
    );

    return reply.send(stats);
  });
}
