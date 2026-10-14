export type TickKind = "settle" | "reconcile";

export interface SettlementRunnerConfig {
  settle: () => Promise<unknown>;
  reconcile: () => Promise<unknown>;
  settleIntervalMs: number;
  reconcileIntervalMs: number;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface SettlementRunner {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<{ settle: unknown; reconcile: unknown }>;
}

export function createSettlementRunner(cfg: SettlementRunnerConfig): SettlementRunner {
  const setInt = cfg.setIntervalFn ?? setInterval;
  const clearInt = cfg.clearIntervalFn ?? clearInterval;
  const timers: Array<ReturnType<typeof setInterval>> = [];
  let inFlight = false;

  async function guarded(kind: "settle" | "reconcile", fn: () => Promise<unknown>): Promise<void> {
    if (inFlight) {
      cfg.logger?.("settlement.tick_skipped", { kind });
      return;
    }
    inFlight = true;
    try {
      await fn();
    } catch (err) {
      cfg.logger?.("settlement.tick_error", { kind, error: String(err) });
    } finally {
      inFlight = false;
    }
  }

  return {
    async runOnce() {
      return { settle: await cfg.settle(), reconcile: await cfg.reconcile() };
    },
    start() {
      void guarded("reconcile", cfg.reconcile);
      const settleTimer = setInt(() => void guarded("settle", cfg.settle), cfg.settleIntervalMs);
      const reconcileTimer = setInt(
        () => void guarded("reconcile", cfg.reconcile),
        cfg.reconcileIntervalMs,
      );
      settleTimer.unref?.();
      reconcileTimer.unref?.();
      timers.push(settleTimer, reconcileTimer);
    },
    stop() {
      for (const timer of timers) clearInt(timer);
      timers.length = 0;
    },
  };
}
