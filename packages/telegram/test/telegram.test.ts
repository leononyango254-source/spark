import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "../src/initData";
import { isAcceptedMembership } from "../src/membership";

const TOKEN = "123456:FAKE_TEST_BOT_TOKEN";
const NOW = 1_800_000_000;

function base(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(NOW),
    query_id: "AAF",
    user: JSON.stringify({ id: 42, first_name: "Alice", username: "alice" }),
    ...overrides,
  };
}

describe("validateInitData", () => {
  it("accepts a valid payload", () => {
    const res = validateInitData(signInitData(base(), TOKEN), TOKEN, { now: NOW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user?.id).toBe(42);
  });

  it("rejects tampering", () => {
    const res = validateInitData(signInitData(base(), TOKEN).replace("alice", "mallory"), TOKEN, {
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects a stale auth_date", () => {
    const res = validateInitData(
      signInitData(base({ auth_date: String(NOW - 301) }), TOKEN),
      TOKEN,
      {
        now: NOW,
      },
    );
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts the 300s boundary", () => {
    const res = validateInitData(
      signInitData(base({ auth_date: String(NOW - 300) }), TOKEN),
      TOKEN,
      {
        now: NOW,
      },
    );
    expect(res.ok).toBe(true);
  });
});

describe("membership", () => {
  it("accepts creator/administrator/member", () => {
    expect(isAcceptedMembership({ status: "creator" })).toBe(true);
    expect(isAcceptedMembership({ status: "administrator" })).toBe(true);
    expect(isAcceptedMembership({ status: "member" })).toBe(true);
  });

  it("accepts restricted only when is_member", () => {
    expect(isAcceptedMembership({ status: "restricted", is_member: true })).toBe(true);
    expect(isAcceptedMembership({ status: "restricted", is_member: false })).toBe(false);
  });

  it("rejects left/kicked", () => {
    expect(isAcceptedMembership({ status: "left" })).toBe(false);
    expect(isAcceptedMembership({ status: "kicked" })).toBe(false);
  });
});
