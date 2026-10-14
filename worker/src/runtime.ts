import type { PublicClient } from "viem";
import { ARC_MIN_MAX_FEE_PER_GAS_WEI, createArcPublicClient } from "@spark/arc";
import type { Db } from "@spark/db";
import { type Address, createViemWalletProvider } from "@spark/wallet";
import type { WorkerEnv } from "./env";
import { createOnchainSettlement } from "./settlement/port";

export { workerEnvSchema } from "./env";
export type { WorkerEnv } from "./env";
export { runSettlementCycle } from "./settlement";
export { runReconciliation } from "./reconciliation";
export { createOnchainSettlement } from "./settlement/port";

export interface WorkerRuntimeDeps {
  db: Db;
  settlement: ReturnType<typeof createOnchainSettlement>;
  escrowAddress: Address;
  chainId: number;
  publicClient: Pick<PublicClient, "getBlockNumber" | "getLogs">;
  batchLimit: number;
  maxAttempts: number;
}

export function buildRuntime(
  env: WorkerEnv,
  db: Db,
): {
  deps: WorkerRuntimeDeps;
  intervals: { settleSeconds: number; reconcileSeconds: number };
} {
  const wallet = createViemWalletProvider({
    rpcUrl: env.ARC_RPC_URL,
    chainId: env.ARC_CHAIN_ID,
    privateKey: env.OPERATOR_PRIVATE_KEY as `0x${string}`,
    minMaxFeePerGasWei: ARC_MIN_MAX_FEE_PER_GAS_WEI,
  });
  const settlement = createOnchainSettlement({
    wallet,
    escrowAddress: env.ESCROW_ADDRESS as Address,
  });
  const publicClient = createArcPublicClient(env.ARC_RPC_URL, env.ARC_CHAIN_ID);
  return {
    deps: {
      db,
      settlement,
      escrowAddress: env.ESCROW_ADDRESS as Address,
      chainId: env.ARC_CHAIN_ID,
      publicClient,
      batchLimit: env.SETTLE_BATCH_LIMIT,
      maxAttempts: env.SETTLE_MAX_ATTEMPTS,
    },
    intervals: {
      settleSeconds: env.SETTLE_INTERVAL_SECONDS,
      reconcileSeconds: env.RECONCILE_INTERVAL_SECONDS,
    },
  };
}
