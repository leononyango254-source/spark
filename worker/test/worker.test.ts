import { describe, expect, it, vi } from "vitest";
import { createBoss, registerWorkers } from "../src/index";
import { QUEUES } from "../src/queues";

describe("worker", () => {
  it("defines the required queues", () => {
    expect(Object.values(QUEUES)).toEqual(["settlement", "reconciliation"]);
  });

  it("constructs a boss instance without connecting", () => {
    const boss = createBoss("postgres://spark:spark@localhost:5432/spark");
    expect(boss).toBeDefined();
  });

  it("registers and schedules both queues", async () => {
    const createQueue = vi.fn(async () => {});
    const work = vi.fn(async () => "id");
    const schedule = vi.fn(async () => {});
    const boss = { createQueue, work, schedule } as never;
    await registerWorkers(
      boss,
      {
        db: {} as never,
        settlement: {} as never,
        escrowAddress: `0x${"1".repeat(40)}`,
        chainId: 5042002,
        publicClient: {} as never,
        batchLimit: 25,
        maxAttempts: 5,
      },
      { settleSeconds: 15, reconcileSeconds: 30 },
    );
    expect(createQueue).toHaveBeenCalledWith(QUEUES.settlement);
    expect(createQueue).toHaveBeenCalledWith(QUEUES.reconciliation);
    expect(schedule).toHaveBeenCalledWith(QUEUES.settlement, "*/15 * * * * *");
    expect(schedule).toHaveBeenCalledWith(QUEUES.reconciliation, "*/30 * * * * *");
  });
});