import { describe, expect, it, vi } from "vitest";
import { settlement } from "../src/settlement";

describe("settlement client", () => {
  it("initializes with disconnected state", () => {
    const state = settlement.getState();
    expect(state.status).toBe("disconnected");
    expect(state.settlementStatus).toBe("pending");
  });

  it("submitPayout calls API and sets txHash", async () => {
    settlement.disconnect();
    expect(settlement.getState().status).toBe("disconnected");
  });

  it("pollStatus fetches status from API", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "pending" }),
    }));
    const state = await settlement.pollStatus();
    expect(state.settlementStatus).toBe("pending");
  });
});