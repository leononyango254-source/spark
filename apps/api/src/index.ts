import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { TelegramBotClient } from "@spark/telegram";
import { type WalletConnectConfig, WalletConnectSessionManager } from "@spark/wallet";
import { buildRuntime, runReconciliation, runSettlementCycle } from "@spark/worker/runtime";
import { createMembershipCache } from "./cache/membershipCache";
import { buildDb } from "./db";
import { loadEnv } from "./env";
import { buildServer, type SettlementService } from "./server";
import { loadSettlementConfig } from "./settlement/config";
import { createSettlementRunner } from "./settlement/runner";

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to start the API");
}

const db = buildDb(env.DATABASE_URL);

let walletConnect: WalletConnectSessionManager | undefined;
if (env.WALLETCONNECT_PROJECT_ID) {
  walletConnect = await WalletConnectSessionManager.create({
    projectId: env.WALLETCONNECT_PROJECT_ID,
    relayUrl: env.WALLETCONNECT_RELAY_URL,
    metadata: {
      name: "Spark",
      description: "Spark wallet onboarding",
      url: "https://spark.app",
      icons: ["https://spark.app/favicon.ico"],
    },
  } as WalletConnectConfig);
}

const settlement: SettlementService = {
  getUserBalance: async () => 0n,
  submitSettlement: async () => ({
    hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    awaitReceipt: async () => {},
  }),
  getSettlementStatus: async () => ({ status: "pending" }),
};
const deps: Parameters<typeof buildServer>[0] = {
  db,
  telegram: env.TELEGRAM_BOT_TOKEN
    ? new TelegramBotClient({ botToken: env.TELEGRAM_BOT_TOKEN })
    : undefined,
  membershipCache: createMembershipCache(env.MEMBERSHIP_CACHE_TTL_MS),
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
  nodeEnv: env.NODE_ENV,
  campaignEngine: createCampaignEngine({ db }),
  referralEngine: createReferralEngine({ db }),
  rewardEngine: createRewardEngine({ db }),
  botUsername: env.TELEGRAM_BOT_USERNAME ?? "sparkbot",
  appName: env.TELEGRAM_APP_NAME ?? "app",
  settlement,
};

const settlementConfig = loadSettlementConfig(env);
if (settlementConfig.status === "misconfigured") {
  console.warn(
    `settlement: SETTLEMENT_ENABLED=true but missing/invalid config: ${settlementConfig.missing.join(", ")}`,
  );
}
if (settlementConfig.status === "ready") {
  const { deps: runtime, intervals } = buildRuntime(settlementConfig.config.workerEnv, db);
  const runner = createSettlementRunner({
    settle: () =>
      runSettlementCycle({
        db,
        settlement: runtime.settlement,
        limit: runtime.batchLimit,
        maxAttempts: runtime.maxAttempts,
      }),
    reconcile: () =>
      runReconciliation({
        db,
        publicClient: runtime.publicClient,
        escrowAddress: runtime.escrowAddress,
        chainId: runtime.chainId,
      }),
    settleIntervalMs: intervals.settleSeconds * 1000,
    reconcileIntervalMs: intervals.reconcileSeconds * 1000,
    logger: (event, meta) => console.warn(`settlement: ${event}`, meta ?? {}),
  });
  runner.start();
  deps.admin = { runner, adminToken: settlementConfig.config.adminToken };
}

if (walletConnect !== undefined) {
  deps.walletConnect = walletConnect;
  deps.settlement = settlement;
}

if (env.WEB_DIST_DIR) {
  deps.webDistDir = env.WEB_DIST_DIR;
}

if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_WEBAPP_URL) {
  deps.telegramWebhook = {
    secret: env.TELEGRAM_WEBHOOK_SECRET,
    webappUrl: env.TELEGRAM_WEBAPP_URL,
  };
}

const app = buildServer(deps);

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => app.log.info(`spark-api listening on ${address}`))
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
