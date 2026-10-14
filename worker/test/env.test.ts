import { describe, expect, it } from "vitest";
import { loadWorkerEnv } from "../src/env";

const base = {
  DATABASE_URL: "postgres://spark:spark@localhost:5433/spark",
  ESCROW_ADDRESS: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64",
  OPERATOR_PRIVATE_KEY: `0x${"a".repeat(64)}`,
};

describe("worker env", () => {
  it("applies defaults", () => {
    const env = loadWorkerEnv(base as NodeJS.ProcessEnv);
    expect(env.ARC_CHAIN_ID).toBe(5042002);
    expect(env.SETTLE_BATCH_LIMIT).toBe(25);
    expect(env.SETTLE_MAX_ATTEMPTS).toBe(5);
  });

  it("rejects a malformed escrow address", () => {
    expect(() => loadWorkerEnv({ ...base, ESCROW_ADDRESS: "nope" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("rejects a missing operator key", () => {
    const { OPERATOR_PRIVATE_KEY: _omit, ...rest } = base;
    expect(() => loadWorkerEnv(rest as NodeJS.ProcessEnv)).toThrow();
  });
});
