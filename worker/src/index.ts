import PgBoss from "pg-boss";
import { QUEUES } from "./queues";
import { registerReconciliationWorker } from "./reconciliation";
import { registerSettlementWorker } from "./settlement";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

export async function start(connectionString: string): Promise<PgBoss> {
  const boss = createBoss(connectionString);
  await boss.start();
  await boss.createQueue(QUEUES.settlement);
  await boss.createQueue(QUEUES.reconciliation);
  registerSettlementWorker(boss);
  registerReconciliationWorker(boss);
  return boss;
}
