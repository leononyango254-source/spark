import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().optional(),
  ARC_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  MEMBERSHIP_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
