import { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import { describe, expect, it, vi } from "vitest";
import { WalletConnectSessionManager } from "../src/walletConnect";

type SignClientInstance = InstanceType<typeof SignClient>;

function fakeSignClient() {
  const sessionStore = new Map<string, SessionTypes.Struct>();
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  return {
    sessionStore,
    on: vi.fn((event: string, handler: (event: unknown) => void) => {
      const arr = listeners.get(event) ?? [];
      arr.push(handler);
      listeners.set(event, arr);
    }),
    connect: vi.fn(async () => ({
      uri: "wc:test-uri@2?relay-protocol=irn&symKey=test",
      topic: "test-topic",
    })),
    session: {
      get: vi.fn((topic: string) => sessionStore.get(topic) ?? null),
    },
    disconnect: vi.fn(async () => {}),
  };
}

describe("WalletConnectSessionManager", () => {
  it("creates a pending session with URI and sessionId", async () => {
    const client = fakeSignClient();
    const manager = WalletConnectSessionManager.createForTest(client as unknown as SignClientInstance);
    const session = await manager.createSession();
    expect(session.uri).toContain("wc:");
    expect(session.sessionId).toBeDefined();
    expect(session.topic).toBe("test-topic");
  });

  it("returns null for unknown approved session", () => {
    const client = fakeSignClient();
    const manager = WalletConnectSessionManager.createForTest(client as unknown as SignClientInstance);
    expect(manager.getApproved("nonexistent")).toBeNull();
  });

  it("disconnects an approved session", async () => {
    const client = fakeSignClient();
    const manager = WalletConnectSessionManager.createForTest(client as unknown as SignClientInstance);
    await manager.disconnect("nonexistent");
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
