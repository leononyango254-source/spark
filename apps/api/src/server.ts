import cookie from "@fastify/cookie";
import type { CampaignEngine } from "@spark/campaign";
import type { Db } from "@spark/db";
import type { ReferralEngine } from "@spark/referral";
import type { RewardEngine } from "@spark/reward";
import type { TelegramBotApi } from "@spark/telegram";
import type { WalletConnectSessionManager } from "@spark/wallet";
import Fastify, { type FastifyInstance } from "fastify";
import type { MembershipCache } from "./cache/membershipCache";
import { registerAuthRoutes } from "./routes/auth";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerMeRoutes } from "./routes/me";
import { registerVerifyRoutes } from "./routes/verify";
import { registerWalletRoutes } from "./routes/wallet";

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
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "spark-api" }));

  app.register(async (instance) => {
    registerAuthRoutes(instance, deps);
    registerMeRoutes(instance, deps);
    registerVerifyRoutes(instance, deps);
    registerCampaignRoutes(instance, deps);
    registerWalletRoutes(instance, deps);
  });

  return app;
}
