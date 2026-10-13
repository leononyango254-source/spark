import PgBoss from "pg-boss";
import type { PublicClient } from "viem";
import {
  createArcPublicClient,
  ARC_MIN_MAX_FEE_PER_GAS_WEI,
} from "@spark/arc";
import type { Db } from "@spark/db";
import { createViemWalletProvider, type Address } from "@spark/wallet";
import { intervalToCron } from "./cron";
import type { WorkerEnv } from "./env";
import { QUEUES } from "./queues";
import { runReconciliation } from "./reconciliation";
import { runSettlementCycle } from "./settlement";
import { createOnchainSettlement } from "./settlement/port";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

export interface WorkerRuntimeDeps {
  db: Db;
  settlement: ReturnType<typeof createOnchainSettlement>;
  escrowAddress: Address;
  chainId: number;
  publicClient: Pick<PublicClient, "getBlockNumber" | "getLogs">;
  batchLimit: number;
  maxAttempts: number;
}

export async function registerWorkers(
  boss: PgBoss,
  deps: WorkerRuntimeDeps,
  intervals: { settleSeconds: number; reconcileSeconds: number },
): Promise<void> {
  await boss.createQueue(QUEUES.settlement);
  await boss.createQueue(QUEUES.reconciliation);

  await boss.work(QUEUES.settlement, async () => {
    await runSettlementCycle({
      db: deps.db,
      settlement: deps.settlement,
      limit: deps.batchLimit,
      maxAttempts: deps.maxAttempts,
    });
  });

  await boss.work(QUEUES.reconciliation, async () => {
    await runReconciliation({
      db: deps.db,
      publicClient: deps.publicClient,
      escrowAddress: deps.escrowAddress,
      chainId: deps.chainId,
    });
  });

  await boss.schedule(QUEUES.settlement, intervalToCron(intervals.settleSeconds));
  await boss.schedule(QUEUES.reconciliation, intervalToCron(intervals.reconcileSeconds));
}

export async function start(
  connectionString: string,
  deps: WorkerRuntimeDeps,
  intervals: { settleSeconds: number; reconcileSeconds: number },
): Promise<PgBoss> {
  const boss = createBoss(connectionString);
  await boss.start();
  await registerWorkers(boss, deps, intervals);
  return boss;
}

export function buildRuntime(env: WorkerEnv, db: Db): {
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