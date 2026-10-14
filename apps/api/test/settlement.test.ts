import { describe, expect, it, vi } from "vitest";
import type { Db, UserRow } from "@spark/db";
import type { WalletConnectSessionManager } from "@spark/wallet";
import { buildServer, type SettlementService } from "../src/server";

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

function fakeSettlementService(): SettlementService {
  return {
    getUserBalance: vi.fn(async () => 0n),
    submitSettlement: vi.fn(async () => ({
      hash: `0x${Math.random().toString(16).slice(2)}` as `0x${string}`,
      awaitReceipt: async () => {},
    })),
    getSettlementStatus: vi.fn(async (txHash: string) => {
      if (txHash === "0xpending") {
        return { status: "pending" as const };
      }
      return { status: "settled" as const, receipt: { transactionHash: txHash } };
    }),
  };
}

function buildTestServer(
  user: UserRow | null,
  walletConnect: WalletConnectSessionManager,
  settlement: SettlementService,
) {
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
    settlement,
  } as never);
}

describe("settlement routes", () => {
  it("rejects unauthenticated submit", async () => {
    const wc = fakeSettlementService() as unknown as WalletConnectSessionManager;
    const settlement = fakeSettlementService();
    const app = buildTestServer(null, wc, settlement);
    const res = await app.inject({
      method: "POST",
      url: "/api/settlement/submit",
      payload: { address: "0x123", amount: "100", chainId: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("submits a settlement transaction", async () => {
    const wc = fakeSettlementService() as unknown as WalletConnectSessionManager;
    const settlement = fakeSettlementService();
    settlement.submitSettlement = vi.fn(async () => ({
      hash: `0x${Math.random().toString(16).slice(2)}` as `0x${string}`,
      awaitReceipt: async () => {},
    }));
    const app = buildTestServer(fakeUser(), wc, settlement);
    const res = await app.inject({
      method: "POST",
      url: "/api/settlement/submit",
      headers: { authorization: "Bearer valid-token" },
      payload: { address: "0x123", amount: "100", chainId: 1 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("submitted");
    expect(body.txHash).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it("returns pending status for unmined tx", async () => {
    const wc = fakeSettlementService() as unknown as WalletConnectSessionManager;
    const settlement = fakeSettlementService();
    settlement.getSettlementStatus = vi.fn(async (txHash: string) => {
      if (txHash === "0xpending") {
        return { status: "pending" as const };
      }
      return { status: "settled" as const, receipt: { transactionHash: txHash } };
    });
    const app = buildTestServer(fakeUser(), wc, settlement);
    const res = await app.inject({
      method: "GET",
      url: "/api/settlement/status/0xpending",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("returns settled status with receipt", async () => {
    const wc = fakeSettlementService() as unknown as WalletConnectSessionManager;
    const settlement = fakeSettlementService();
    settlement.getSettlementStatus = vi.fn(async (txHash: string) => ({
      status: "settled" as const,
      receipt: { transactionHash: txHash },
    }));
    const app = buildTestServer(fakeUser(), wc, settlement);
    const res = await app.inject({
      method: "GET",
      url: "/api/settlement/status/0xabc123",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("settled");
    expect(body.receipt).toBeDefined();
  });
});
