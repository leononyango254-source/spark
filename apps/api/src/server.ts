import Fastify, { type FastifyInstance } from "fastify";

/** Build the Fastify application. No business routes yet (added in later phases). */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "spark-api" }));

  return app;
}
