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

it("is disabled when SETTLEMENT_ENABLED is explicitly 'false'", () => {
  const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "false" });
  expect(loadSettlementConfig(env).status).toBe("disabled");
});

it("flags a present-but-invalid value", () => {
  const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true", ESCROW_ADDRESS: "0xnope" });
  const result = loadSettlementConfig(env);
  expect(result.status).toBe("misconfigured");
  if (result.status === "misconfigured") expect(result.missing).toContain("ESCROW_ADDRESS");
});

it("flags a missing ADMIN_TOKEN", () => {
  const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true", ADMIN_TOKEN: undefined });
  const result = loadSettlementConfig(env);
  expect(result.status).toBe("misconfigured");
  if (result.status === "misconfigured") expect(result.missing).toContain("ADMIN_TOKEN");
});

it("does not throw on empty/malformed optional vars while disabled", () => {
  const env = loadEnv({
    ...base,
    SETTLEMENT_ENABLED: "false",
    ADMIN_TOKEN: "",
    ARC_RPC_URL: "",
    ARC_CHAIN_ID: "abc",
    SETTLE_INTERVAL_SECONDS: "",
  });
  expect(loadSettlementConfig(env).status).toBe("disabled");
});

it("requires explicit RPC/chain when ARC_NETWORK is mainnet", () => {
  const env = loadEnv({ ...base, SETTLEMENT_ENABLED: "true", ARC_NETWORK: "mainnet" });
  const result = loadSettlementConfig(env);
  expect(result.status).toBe("misconfigured");
  if (result.status === "misconfigured") {
    expect(result.missing).toContain("ARC_RPC_URL");
    expect(result.missing).toContain("ARC_CHAIN_ID");
  }
});
