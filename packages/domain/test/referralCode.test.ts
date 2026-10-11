import { describe, expect, it } from "vitest";
import { generateReferralCode, REFERRAL_CODE_PATTERN } from "../src/referralCode";

describe("referralCode", () => {
  it("returns an 8-char URL-safe code", () => {
    const code = generateReferralCode();
    expect(code).toMatch(REFERRAL_CODE_PATTERN);
    expect(code.length).toBe(8);
  });

  it("produces distinct codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 512; i++) seen.add(generateReferralCode());
    expect(seen.size).toBe(512);
  });
});
