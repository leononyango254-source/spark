import type { Db } from "@spark/db";
import { describe, expect, it } from "vitest";
import { buildRuntime, runReconciliation, runSettlementCycle } from "../src/runtime";
import type { WorkerEnv } from "../src/env";

const env: WorkerEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://spark:spark@localhost:5433/spark",
  ARC_NETWORK: "testnet",
  ARC_RPC_URL: "https://rpc.testnet.arc.io",
  ARC_CHAIN_ID: 5042002,
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  ESCROW_ADDRESS: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64",
  OPERATOR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  SETTLE_BATCH_LIMIT: 25,
  SETTLE_INTERVAL_SECONDS: 15,
  RECONCILE_INTERVAL_SECONDS: 30,
  SETTLE_MAX_ATTEMPTS: 5,
};

describe("worker runtime", () => {
  it("re-exports the settlement + reconciliation functions", () => {
    expect(typeof runSettlementCycle).toBe("function");
    expect(typeof runReconciliation).toBe("function");
  });

  it("builds a runtime without network calls", () => {
    const { deps, intervals } = buildRuntime(env, {} as Db);
    expect(typeof deps.settlement.submitPayout).toBe("function");
    expect(deps.escrowAddress).toBe(env.ESCROW_ADDRESS);
    expect(deps.chainId).toBe(5042002);
    expect(intervals).toEqual({ settleSeconds: 15, reconcileSeconds: 30 });
  });

  it("re-exports workerEnvSchema", async () => {
    const mod = await import("../src/runtime");
    expect(typeof mod.workerEnvSchema.safeParse).toBe("function");
  });
});
