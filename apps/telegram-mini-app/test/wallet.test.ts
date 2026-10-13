import { describe, expect, it, vi } from "vitest";
import { walletConnect, walletConnectInit, walletPollStatus, walletDisconnect } from "../src/wallet";

describe("wallet connect client", () => {
  it("initializes with projectId", () => {
    const { getState } = walletConnectInit("test-project-id");
    expect(walletConnect.getState().status).toBe("disconnected");
  });

  it("pollStatus cycles through states", async () => {
    walletConnect.disconnect();
    const initial = await walletPollStatus();
    expect(initial.status).toBe("disconnected");
    const afterPoll = await walletPollStatus();
    expect(afterPoll.status).toBe("connecting");
    const afterPoll2 = await walletPollStatus();
    expect(afterPoll2.status).toBe("connected");
  });

  it("disconnect resets state", async () => {
    walletConnect.disconnect();
    await walletPollStatus(); // move to connected
    await walletDisconnect();
    expect(walletConnect.getState().status).toBe("disconnected");
    expect(walletConnect.getState().sessionId).toBeUndefined();
  });
});