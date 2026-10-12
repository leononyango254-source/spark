import PgBoss from "pg-boss";
import { QUEUES } from "./queues";
import { registerReconciliationWorker } from "./reconciliation";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

export async function start(connectionString: string): Promise<PgBoss> {
  const boss = createBoss(connectionString);
  await boss.start();
  await boss.createQueue(QUEUES.reconciliation);
  registerReconciliationWorker(boss);
  return boss;
}
