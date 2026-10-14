import { describe, expect, it, vi } from "vitest";
import type { Db, UserRow } from "@spark/db";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { buildServer } from "../src/server";

function fakeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    telegramUserId: 12345n,
    username: "test",
    firstName: null,
    lastName: null,
    languageCode: null,
    walletAddress: null,
    walletProvider: null,
    walletStatus: null,
    walletChainId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeDb(user: UserRow | null): Db {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn((_table: string) => ({
        where: vi.fn((_condition: unknown) => ({
          limit: vi
            .fn()
            .mockResolvedValue(
              user
                ? [
                    {
                      id: "sess-1",
                      userId: user.id,
                      tokenHash: "hash",
                      expiresAt: new Date(Date.now() + 3600000),
                      revokedAt: null,
                    },
                  ]
                : [],
            ),
        })),
      })),
    }),
  } as unknown as Db;
}

function fakeWalletConnect() {
  return {
    createSession: vi.fn(async () => ({
      sessionId: "sess-1",
      uri: "wc:test@2?relay-protocol=irn&symKey=abc",
      topic: "topic-1",
    })),
    getApproved: vi.fn(() => null),
    disconnect: vi.fn(async () => {}),
  } as unknown as WalletConnectSessionManager;
}

function buildTestServer(user: UserRow | null, walletConnect: WalletConnectSessionManager) {
  const db = fakeDb(user);
  return buildServer({
    db,
    telegram: undefined,
    membershipCache: { get: vi.fn(), set: vi.fn() } as never,
    campaignEngine: {} as never,
    referralEngine: {} as never,
    rewardEngine: {} as never,
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    botUsername: "testbot",
    appName: "test",
    walletConnect,
  } as never);
}

describe("wallet routes", () => {
  it("rejects unauthenticated connect", async () => {
    const app = buildTestServer(null, fakeWalletConnect());
    const res = await app.inject({ method: "POST", url: "/api/wallet/connect" });
    expect(res.statusCode).toBe(401);
  });

  it("creates a session for authenticated user", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "POST",
      url: "/api/wallet/connect",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe("sess-1");
    expect(body.uri).toContain("wc:");
  });

  it("returns pending status for unapproved session", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "GET",
      url: "/api/wallet/connect/sess-1",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("returns connected status for approved session", async () => {
    const wc = fakeWalletConnect();
    wc.getApproved = vi.fn(() => ({
      address: "0x00000000000000000000000000000000000000A1" as const,
      chainId: 5042002,
      topic: "topic-1",
    }));
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "GET",
      url: "/api/wallet/connect/sess-1",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("connected");
    expect(body.address).toBe("0x00000000000000000000000000000000000000A1");
  });

  it("disconnects a session", async () => {
    const wc = fakeWalletConnect();
    const app = buildTestServer(fakeUser(), wc);
    const res = await app.inject({
      method: "POST",
      url: "/api/wallet/disconnect",
      headers: { authorization: "Bearer valid-token" },
      payload: { sessionId: "sess-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(wc.disconnect).toHaveBeenCalledWith("sess-1");
  });
});
