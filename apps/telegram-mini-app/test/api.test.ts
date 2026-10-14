import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthResponse,
  authenticate,
  buildApiUrl,
  type VerifyResponse,
  verify,
} from "../src/api";

describe("api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  describe("buildApiUrl", () => {
    it("builds correct URL with origin and path", () => {
      const url = buildApiUrl("http://api.example.com", "/api/auth/telegram");
      expect(url).toBe("http://api.example.com/api/auth/telegram");
    });

    it("handles trailing slash in origin", () => {
      const url = buildApiUrl("http://api.example.com/", "/api/auth/telegram");
      expect(url).toBe("http://api.example.com/api/auth/telegram");
    });

    it("returns a relative path when origin is empty", () => {
      expect(buildApiUrl("", "/api/auth/telegram")).toBe("/api/auth/telegram");
    });
  });

  describe("authenticate", () => {
    it("returns AuthResponse on success", async () => {
      const mockResponse: AuthResponse = {
        token: "test-token-123",
        expiresAt: "2026-01-01T00:00:00.000Z",
        user: { id: "user-1", telegramUserId: "123456", username: "testuser" },
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await authenticate("http://api.example.com", "init-data-string");
      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://api.example.com/api/auth/telegram",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: "init-data-string" }),
        }),
      );
    });

    it("throws on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Invalid initData" }),
      });

      await expect(authenticate("http://api.example.com", "bad-data")).rejects.toThrow(
        "auth failed: 401",
      );
    });
  });

  it("includes referral context in the auth request", async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ token: "t", expiresAt: "", user: {} }) };
    }) as unknown as typeof fetch;

    const { authenticate } = await import("../src/api");
    await authenticate("https://api.example", "raw-init-data", {
      referralCode: "code1234",
      campaignPublicId: "pub1234567890abcd",
    });
    expect(calls[0]!.body).toMatchObject({
      initData: "raw-init-data",
      referralCode: "code1234",
      campaignPublicId: "pub1234567890abcd",
    });
  });

  describe("verify", () => {
    it("returns VerifyResponse on success", async () => {
      const mockResponse: VerifyResponse = {
        verified: true,
        memberStatus: "member",
        campaignId: "campaign-123",
        cached: false,
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await verify("http://api.example.com", "token-123", "campaign-123", false);
      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://api.example.com/api/campaigns/campaign-123/verify",
        expect.objectContaining({
          method: "POST",
          headers: { authorization: "Bearer token-123" },
        }),
      );
    });

    it("includes force=1 query param when force is true", async () => {
      const mockResponse: VerifyResponse = {
        verified: true,
        memberStatus: "member",
        campaignId: "campaign-123",
        cached: true,
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await verify("http://api.example.com", "token-123", "campaign-123", true);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://api.example.com/api/campaigns/campaign-123/verify?force=1",
        expect.any(Object),
      );
    });

    it("throws on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Not a member" }),
      });

      await expect(
        verify("http://api.example.com", "token-123", "campaign-123", false),
      ).rejects.toThrow("verify failed: 403");
    });
  });
});
