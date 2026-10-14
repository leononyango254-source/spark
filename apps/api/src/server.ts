import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { CampaignEngine } from "@spark/campaign";
import type { Db } from "@spark/db";
import type { ReferralEngine } from "@spark/referral";
import type { RewardEngine } from "@spark/reward";
import type { TelegramBotApi } from "@spark/telegram";

import type { WalletConnectSessionManager } from "@spark/wallet";
import Fastify, { type FastifyInstance } from "fastify";

export type SettlementService = {
  getUserBalance: (userAddress: `0x${string}`, _chainId: number) => Promise<bigint>;
  submitSettlement: (
    userAddress: `0x${string}`,
    amount: bigint,
    _chainId: number,
    walletConnectMgr: WalletConnectSessionManager,
  ) => Promise<{ hash: `0x${string}`; awaitReceipt: () => Promise<void> }>;
  getSettlementStatus: (
    txHash: `0x${string}`,
    intervalMs?: number,
    timeoutMs?: number,
  ) => Promise<{ status: "pending" | "settled"; receipt?: unknown }>;
};
import type { MembershipCache } from "./cache/membershipCache";
import { registerAuthRoutes } from "./routes/auth";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerMeRoutes } from "./routes/me";
import { registerVerifyRoutes } from "./routes/verify";
import { registerWalletRoutes } from "./routes/wallet";
import { registerSettlementRoutes } from "./routes/settlement";
import { registerTelegramWebhookRoutes } from "./routes/telegram";

export interface ApiDeps {
  db: Db;
  telegram: TelegramBotApi | undefined;
  membershipCache: MembershipCache;
  campaignEngine: CampaignEngine;
  referralEngine: ReferralEngine;
  rewardEngine: RewardEngine;
  sessionTtlSeconds: number;
  nodeEnv: "development" | "test" | "production";
  botUsername: string;
  appName: string;
  walletConnect?: WalletConnectSessionManager;
  settlement?: SettlementService;
  telegramWebhook?: { secret: string; webappUrl: string };
  webDistDir?: string;
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "spark-api" }));

  if (deps.webDistDir) {
    app.register(fastifyStatic, { root: deps.webDistDir, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.register(async (instance) => {
    registerAuthRoutes(instance, deps);
    registerMeRoutes(instance, deps);
    registerVerifyRoutes(instance, deps);
    registerCampaignRoutes(instance, deps);
    registerWalletRoutes(instance, deps);
    registerTelegramWebhookRoutes(instance, deps);

    const walletConnect = deps.walletConnect;
    const settlement = deps.settlement;
    if (!walletConnect || !settlement) return;
    registerSettlementRoutes(instance, {
      ...deps,
      walletConnect,
      settlement,
    } as unknown as Parameters<typeof registerSettlementRoutes>[1]);
  });

  return app;
}
