import { z } from "zod";

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  ARC_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_CHAIN_ID: z.coerce.number().int().positive().default(5042002),
  ARC_USDC_ADDRESS: z.string().default("0x3600000000000000000000000000000000000000"),
  ESCROW_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  OPERATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  SETTLE_BATCH_LIMIT: z.coerce.number().int().positive().default(25),
  SETTLE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  SETTLE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(source);
}