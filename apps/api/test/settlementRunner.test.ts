import { describe, expect, it } from "vitest";
import { createSettlementRunner } from "../src/settlement/runner";

describe("createSettlementRunner", () => {
  it("runs one settle + reconcile per runOnce and returns both results", async () => {
    const events: string[] = [];
    const runner = createSettlementRunner({
      settle: async () => {
        events.push("settle");
        return { submitted: 1 };
      },
      reconcile: async () => {
        events.push("reconcile");
        return { healed: 0 };
      },
      settleIntervalMs: 1000,
      reconcileIntervalMs: 1000,
    });
    const stats = await runner.runOnce();
    expect(events).toEqual(["settle", "reconcile"]);
    expect(stats).toEqual({ settle: { submitted: 1 }, reconcile: { healed: 0 } });
  });

  it("guards against overlapping ticks", async () => {
    let settleCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const callbacks: Array<() => void> = [];
    const runner = createSettlementRunner({
      settle: async () => {
        settleCalls += 1;
        await gate;
        return {};
      },
      reconcile: async () => ({}),
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 0));
    const tick = callbacks[0];
    tick?.();
    tick?.();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(settleCalls).toBe(1);
    runner.stop();
  });

  it("isolates tick errors and keeps running", async () => {
    const errors: Array<{ event: string; meta?: Record<string, unknown> | undefined }> = [];
    const callbacks: Array<() => void> = [];
    const runner = createSettlementRunner({
      settle: async () => {
        throw new Error("boom");
      },
      reconcile: async () => ({}),
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      logger: (event, meta) => errors.push({ event, meta }),
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 0));
    callbacks[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors.some((e) => e.event === "settlement.tick_error")).toBe(true);
    runner.stop();
  });
});
