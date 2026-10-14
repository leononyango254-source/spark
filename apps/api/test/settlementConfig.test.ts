import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { loadSettlementConfig } from "../src/settlement/config";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://spark:spark@localhost:5433/spark",
  ESCROW_ADDRESS: "0x9539efAFf246799827E6F5E6Cbc475122710Ef64",
  OPERATOR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  ADMIN_TOKEN: "secret",
};

describe("loadSettlementConfig", () => {
  it("is disabled by default", () => {
    expect(loadSettlementConfig(loadEnv(base)).status).toBe("disabled");
  });

  it("is misconfigured when enabled but required vars are missing", () => {
    const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true", OPERATOR_PRIVATE_KEY: undefined });
    const result = loadSettlementConfig(env);
    expect(result.status).toBe("misconfigured");
    if (result.status === "misconfigured") expect(result.missing).toContain("OPERATOR_PRIVATE_KEY");
  });

  it("is ready when enabled with all required vars", () => {
    const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true" });
    const result = loadSettlementConfig(env);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.config.adminToken).toBe("secret");
      expect(result.config.workerEnv.ESCROW_ADDRESS).toBe(base.ESCROW_ADDRESS);
      expect(result.config.workerEnv.ARC_CHAIN_ID).toBe(5042002);
    }
  });
});
