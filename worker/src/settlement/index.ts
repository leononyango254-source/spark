import type PgBoss from "pg-boss";

/**
 * Settlement worker. Watches AGREED rewards, authorizes + submits `payReward`,
 * and advances the reward state machine. Implemented in a later phase.
 */
export function registerSettlementWorker(boss: PgBoss): void {
  void boss;
}
