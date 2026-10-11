import type PgBoss from "pg-boss";

/**
 * Reconciliation worker. Matches on-chain Transfer/event logs to ledger entries and
 * detects dropped/replaced transactions. Implemented in a later phase.
 */
export function registerReconciliationWorker(boss: PgBoss): void {
  void boss;
}
