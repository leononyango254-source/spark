import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateTelegram } from "../auth/authenticateTelegram";
import type { ApiDeps } from "../server";

const bodySchema = z.object({ initData: z.string().min(1) });

export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post("/api/auth/telegram", async (request, reply) => {
    if (!deps.telegramBotToken) {
      return reply.code(503).send({ error: "telegram_not_configured" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const outcome = await authenticateTelegram(deps.db, {
      initData: parsed.data.initData,
      botToken: deps.telegramBotToken,
      sessionTtlSeconds: deps.sessionTtlSeconds,
    });
    if (!outcome.ok) return reply.code(401).send({ error: "unauthorized", reason: outcome.reason });

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
