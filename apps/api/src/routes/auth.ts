import { findCampaignByPublicId } from "@spark/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateTelegram } from "../auth/authenticateTelegram";
import type { ApiDeps } from "../server";

const bodySchema = z.object({
  initData: z.string().min(1),
  referralCode: z
    .string()
    .regex(/^[0-9a-z]{8}$/)
    .optional(),
  campaignPublicId: z
    .string()
    .regex(/^[0-9a-z]{16,32}$/)
    .optional(),
});

export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post("/api/auth/telegram", async (request, reply) => {
    if (!deps.telegram) {
      return reply.code(503).send({ error: "telegram_not_configured" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const outcome = await authenticateTelegram(deps.db, {
      initData: parsed.data.initData,
      botToken: deps.telegram.botToken,
      sessionTtlSeconds: deps.sessionTtlSeconds,
    });
    if (!outcome.ok) return reply.code(401).send({ error: "unauthorized", reason: outcome.reason });

    if (parsed.data.referralCode && parsed.data.campaignPublicId) {
      try {
        const campaign = await findCampaignByPublicId(deps.db, parsed.data.campaignPublicId);
        if (campaign) {
          const referrer = await deps.referralEngine.findReferrerByCode(
            deps.db,
            campaign.id,
            parsed.data.referralCode,
          );
          if (referrer) {
            await deps.referralEngine.attribute({
              campaignId: campaign.id,
              referrerUserId: referrer.id,
              referredUserId: outcome.result.user.id,
              referralCode: parsed.data.referralCode,
            });
          }
        }
      } catch {
        // attribution never blocks authentication
      }
    }

    const { token, expiresAt, user } = outcome.result;
    reply.setCookie("spark_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: deps.nodeEnv === "production",
      path: "/",
      expires: expiresAt,
    });
    return reply.send({
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        telegramUserId: user.telegramUserId.toString(),
        username: user.username,
      },
    });
  });
}
