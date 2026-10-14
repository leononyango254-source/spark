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

function formatError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

export function createSettlementRunner(cfg: SettlementRunnerConfig): SettlementRunner {
  const setInt = cfg.setIntervalFn ?? setInterval;
  const clearInt = cfg.clearIntervalFn ?? clearInterval;
  const timers: Array<ReturnType<typeof setInterval>> = [];
  let busy = false;
  let started = false;

  async function exclusive<T>(
    kind: TickKind,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    if (busy) {
      cfg.logger?.("settlement.tick_skipped", { kind });
      return { ran: false };
    }
    busy = true;
    try {
      return { ran: true, value: await fn() };
    } catch (err) {
      cfg.logger?.("settlement.tick_error", { kind, error: formatError(err) });
      return { ran: false };
    } finally {
      busy = false;
    }
  }

  return {
    async runOnce() {
      const result = await exclusive("settle", async () => ({
        settle: await cfg.settle(),
        reconcile: await cfg.reconcile(),
      }));
      if (result.ran) return result.value;
      return { settle: { skipped: true }, reconcile: { skipped: true } };
    },
    start() {
      if (started) return;
      started = true;
      void exclusive("reconcile", cfg.reconcile);
      const settleTimer = setInt(() => void exclusive("settle", cfg.settle), cfg.settleIntervalMs);
      const reconcileTimer = setInt(
        () => void exclusive("reconcile", cfg.reconcile),
        cfg.reconcileIntervalMs,
      );
      settleTimer.unref?.();
      reconcileTimer.unref?.();
      timers.push(settleTimer, reconcileTimer);
    },
    stop() {
      for (const timer of timers) clearInt(timer);
      timers.length = 0;
      started = false;
    },
  };
}
