import PgBoss from "pg-boss";
import { intervalToCron } from "./cron";
import { QUEUES } from "./queues";
import { runReconciliation } from "./reconciliation";
import { runSettlementCycle } from "./settlement";
import type { WorkerRuntimeDeps } from "./runtime";

export { buildRuntime } from "./runtime";
export type { WorkerRuntimeDeps } from "./runtime";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
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
