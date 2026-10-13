import PgBoss from "pg-boss";
import { QUEUES } from "./queues";
import { runReconciliation, type ReconcileDeps } from "./reconciliation";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

export async function start(connectionString: string): Promise<PgBoss> {
  const boss = createBoss(connectionString);
  await boss.start();
  await boss.createQueue(QUEUES.reconciliation);
  return boss;
}

export async function runReconciliationJob(deps: ReconcileDeps) {
  return runReconciliation(deps);
}
