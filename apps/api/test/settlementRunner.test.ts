import { describe, expect, it } from "vitest";
import { createSettlementRunner } from "../src/settlement/runner";

const flush = () => new Promise((r) => setTimeout(r, 0));

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
    await flush();
    const tick = callbacks[0];
    tick?.();
    tick?.();
    release();
    await flush();
    expect(settleCalls).toBe(1);
    runner.stop();
  });

  it("skips a runOnce while a tick is already in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let settleCalls = 0;
    const events: string[] = [];
    const callbacks: Array<() => void> = [];
    const runner = createSettlementRunner({
      settle: async () => {
        settleCalls += 1;
        await gate;
        return { submitted: 1 };
      },
      reconcile: async () => {
        events.push("reconcile");
        return { healed: 0 };
      },
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      logger: (event) => events.push(event),
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    });
    runner.start();
    await flush();
    callbacks[0]?.();
    const stats = await runner.runOnce();
    expect(settleCalls).toBe(1);
    expect(stats).toEqual({ settle: { skipped: true }, reconcile: { skipped: true } });
    expect(events).toContain("settlement.tick_skipped");
    release();
    await flush();
    runner.stop();
  });

  it("isolates tick errors, logs the stack, and keeps running", async () => {
    const errors: Array<{ event: string; meta?: Record<string, unknown> | undefined }> = [];
    const callbacks: Array<() => void> = [];
    let calls = 0;
    const runner = createSettlementRunner({
      settle: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { submitted: 1 };
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
    await flush();
    callbacks[0]?.();
    await flush();
    const errorEvent = errors.find((e) => e.event === "settlement.tick_error");
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent?.meta?.error)).toContain("boom");
    callbacks[0]?.();
    await flush();
    expect(calls).toBe(2);
    runner.stop();
  });

  it("start is idempotent and stop clears the registered timers", async () => {
    const callbacks: Array<() => void> = [];
    const cleared: unknown[] = [];
    const runner = createSettlementRunner({
      settle: async () => ({}),
      reconcile: async () => ({}),
      settleIntervalMs: 10,
      reconcileIntervalMs: 10,
      setIntervalFn: ((cb: () => void) => {
        callbacks.push(cb);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: ((id: unknown) => {
        cleared.push(id);
      }) as unknown as typeof clearInterval,
    });
    runner.start();
    runner.start();
    expect(callbacks.length).toBe(2);
    runner.stop();
    expect(cleared.length).toBe(2);
  });
});
