import { findCampaignByPublicId, findMembershipTask } from "@spark/db";
import { verifyChannelMembership } from "@spark/telegram";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

const querySchema = z.object({
  force: z.coerce.boolean().optional(),
});

function resolveChatId(
  config: Record<string, unknown> | undefined,
  targetChatId: bigint | null,
): bigint | string | null {
  if (config?.chat_id !== undefined) {
    const chatId = config.chat_id;
    // numeric chat_id may lose precision for large IDs; string is preferred
    if (typeof chatId === "number") return BigInt(chatId);
    if (typeof chatId === "string") return chatId;
  }
  return targetChatId;
}

export function registerVerifyRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Params: { publicId: string }; Querystring: { force?: string } }>(
    "/api/campaigns/:publicId/verify",
    { config: { body: { type: "none" } } },
    async (request, reply) => {
      const token = extractToken(request.headers);
      if (!token) return reply.code(401).send({ error: "unauthenticated" });

      const user = await resolveSession(deps.db, token);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });

      if (!deps.telegram) {
        return reply.code(503).send({ error: "telegram_not_configured" });
      }

      const { publicId } = request.params as { publicId: string };
      const { force } = querySchema.parse(request.query);

      const campaign = await findCampaignByPublicId(deps.db, publicId);
      if (!campaign) {
        return reply.code(404).send({ error: "not_found" });
      }

      const task = await findMembershipTask(deps.db, campaign.id);
      if (!task) {
        return reply.code(422).send({ error: "invalid_task" });
      }

      const chatId = resolveChatId(task.config, campaign.targetChatId);
      if (chatId === null) {
        return reply.code(422).send({ error: "invalid_task" });
      }

      const cacheKey = `${campaign.id}:${user.telegramUserId}`;

      if (!force) {
        const cachedEntry = deps.membershipCache.get(cacheKey);
        if (cachedEntry) {
          return reply.send({
            verified: cachedEntry.verified,
            memberStatus: cachedEntry.memberStatus,
            campaignId: campaign.publicId,
            cached: true,
          });
        }
      }

      const result = await verifyChannelMembership(deps.telegram, chatId, user.telegramUserId);

      if (result.ok) {
        deps.membershipCache.set(cacheKey, {
          verified: true,
          memberStatus: result.memberStatus,
          expiresAt: Date.now() + deps.membershipCache.ttlMs,
        });
        return reply.send({
          verified: true,
          memberStatus: result.memberStatus,
          campaignId: campaign.publicId,
          cached: false,
        });
      }

      if (result.reason === "not_member") {
        deps.membershipCache.set(cacheKey, {
          verified: false,
          memberStatus: result.memberStatus,
          expiresAt: Date.now() + deps.membershipCache.ttlMs,
        });
        return reply.code(409).send({
          error: "verification_failed",
          reason: "not_member",
          campaignId: campaign.publicId,
        });
      }

      return reply.code(409).send({
        error: "telegram_error",
        reason: result.reason,
        campaignId: campaign.publicId,
      });
    },
  );
}
