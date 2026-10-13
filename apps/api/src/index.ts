import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { TelegramBotClient } from "@spark/telegram";
import { type WalletConnectConfig, WalletConnectSessionManager } from "@spark/wallet";
import { createMembershipCache } from "./cache/membershipCache";
import { buildDb } from "./db";
import { loadEnv } from "./env";
import { buildServer } from "./server";

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
};

if (walletConnect !== undefined) {
  deps.walletConnect = walletConnect;
}

const app = buildServer(deps);

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => app.log.info(`spark-api listening on ${address}`))
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
