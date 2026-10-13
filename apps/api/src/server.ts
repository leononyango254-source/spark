import cookie from "@fastify/cookie";
import type { CampaignEngine } from "@spark/campaign";
import type { Db } from "@spark/db";
import type { ReferralEngine } from "@spark/referral";
import type { RewardEngine } from "@spark/reward";
import type { TelegramBotApi } from "@spark/telegram";

import type { WalletConnectSessionManager } from "@spark/wallet";
import Fastify, { type FastifyInstance } from "fastify";

type SettlementService = {
  getUserBalance: (userAddress: `0x${string}`, _chainId: number) => Promise<bigint>;
  submitSettlement: (
    userAddress: `0x${string}`,
    amount: bigint,
    _chainId: number,
    walletConnectMgr: any,
  ) => Promise<{ hash: `0x${string}`; awaitReceipt: () => Promise<void> }>;
  getSettlementStatus: (
    txHash: `0x${string}`,
    intervalMs?: number,
    timeoutMs?: number,
  ) => Promise<{ status: string; receipt?: any }>;
};
import type { MembershipCache } from "./cache/membershipCache";
import { registerAuthRoutes } from "./routes/auth";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerMeRoutes } from "./routes/me";
import { registerVerifyRoutes } from "./routes/verify";
import { registerWalletRoutes } from "./routes/wallet";
import { registerSettlementRoutes } from "./routes/settlement";

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
