import { describe, expect, it } from "vitest";
import { createMembershipCache } from "./membershipCache";

describe("createMembershipCache", () => {
  it("stores entries until ttl passes", () => {
    let now = 1_000;
    const cache = createMembershipCache(300_000, () => now);
    cache.set("k", { verified: true, memberStatus: "member", expiresAt: now + 300_000 });
    expect(cache.get("k")).toMatchObject({ verified: true });
    now += 299_999;
    expect(cache.get("k")).toBeDefined();
    now += 2;
    expect(cache.get("k")).toBeUndefined();
  });
});
