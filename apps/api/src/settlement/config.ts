import { type WorkerEnv, workerEnvSchema } from "@spark/worker/runtime";
import type { Env } from "../env";

export interface SettlementConfig {
  workerEnv: WorkerEnv;
  adminToken: string;
}

export type SettlementConfigResult =
  | { status: "disabled" }
  | { status: "misconfigured"; missing: string[] }
  | { status: "ready"; config: SettlementConfig };

export function loadSettlementConfig(env: Env): SettlementConfigResult {
  if (!env.SETTLEMENT_ENABLED) return { status: "disabled" };

  const parsed = workerEnvSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL,
    ARC_NETWORK: env.ARC_NETWORK,
    ARC_RPC_URL: env.ARC_RPC_URL,
    ARC_CHAIN_ID: env.ARC_CHAIN_ID,
    ARC_USDC_ADDRESS: env.ARC_USDC_ADDRESS,
    ESCROW_ADDRESS: env.ESCROW_ADDRESS,
    OPERATOR_PRIVATE_KEY: env.OPERATOR_PRIVATE_KEY,
    SETTLE_BATCH_LIMIT: env.SETTLE_BATCH_LIMIT,
    SETTLE_INTERVAL_SECONDS: env.SETTLE_INTERVAL_SECONDS,
    RECONCILE_INTERVAL_SECONDS: env.RECONCILE_INTERVAL_SECONDS,
    SETTLE_MAX_ATTEMPTS: env.SETTLE_MAX_ATTEMPTS,
  });

  const missing: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) missing.push(issue.path.join("."));
  }
  const adminToken = env.ADMIN_TOKEN;
  if (!adminToken) missing.push("ADMIN_TOKEN");
  if (!parsed.success || !adminToken) {
    return { status: "misconfigured", missing };
  }
  return { status: "ready", config: { workerEnv: parsed.data, adminToken } };
}
