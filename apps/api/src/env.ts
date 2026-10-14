import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().optional(),
  ARC_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
  TELEGRAM_APP_NAME: z.string().min(1).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  MEMBERSHIP_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  WALLETCONNECT_PROJECT_ID: z.string().optional(),
  WALLETCONNECT_RELAY_URL: z.string().optional(),
  SETTLEMENT_PROJECT_ID: z.string().optional().default(""),
  SETTLEMENT_RELAY_URL: z.string().optional().default(""),
  TELEGRAM_WEBAPP_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  SETTLEMENT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ADMIN_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  ARC_RPC_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  ARC_CHAIN_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  ARC_USDC_ADDRESS: z.preprocess(emptyToUndefined, z.string().optional()),
  ESCROW_ADDRESS: z.preprocess(emptyToUndefined, z.string().optional()),
  OPERATOR_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  SETTLE_BATCH_LIMIT: z.preprocess(emptyToUndefined, z.string().optional()),
  SETTLE_INTERVAL_SECONDS: z.preprocess(emptyToUndefined, z.string().optional()),
  RECONCILE_INTERVAL_SECONDS: z.preprocess(emptyToUndefined, z.string().optional()),
  SETTLE_MAX_ATTEMPTS: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
