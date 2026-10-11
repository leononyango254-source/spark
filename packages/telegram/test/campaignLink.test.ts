import { describe, expect, it } from "vitest";
import { buildCampaignDeepLink, buildStartapp, parseStartapp } from "../src";

const PUBLIC = "0123456789abcdef";
const CODE = "abcdefgh";

describe("parseStartapp", () => {
  it("parses a campaign payload with a referral code", () => {
    expect(parseStartapp(`c_${PUBLIC}_${CODE}`)).toEqual({
      kind: "campaign",
      publicId: PUBLIC,
      referralCode: CODE,
    });
  });

  it("parses a campaign payload without a referral code", () => {
    expect(parseStartapp(`c_${PUBLIC}`)).toEqual({
      kind: "campaign",
      publicId: PUBLIC,
      referralCode: undefined,
    });
  });

  it("rejects garbage, wrong prefix, bad ids, and oversized payloads", () => {
    expect(parseStartapp("")).toBeNull();
    expect(parseStartapp("x_123")).toBeNull();
    expect(parseStartapp("c_UPPER")).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_toolong`)).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_${CODE}_extra`)).toBeNull();
    expect(parseStartapp(`c_${PUBLIC}_${CODE}${"a".repeat(60)}`)).toBeNull();
  });
});

describe("buildStartapp", () => {
  it("round-trips through parseStartapp", () => {
    const built = buildStartapp(PUBLIC, CODE);
    expect(parseStartapp(built)).toEqual({
      kind: "campaign",
      publicId: PUBLIC,
      referralCode: CODE,
    });
  });

  it("rejects malformed inputs", () => {
    expect(() => buildStartapp("BROKEN")).toThrow(RangeError);
    expect(() => buildStartapp(PUBLIC, "BROKEN_CODE")).toThrow(RangeError);
  });
});

describe("buildCampaignDeepLink", () => {
  it("builds a t.me deep link", () => {
    expect(buildCampaignDeepLink("sparkbot", "app", `c_${PUBLIC}_${CODE}`)).toBe(
      `https://t.me/sparkbot/app?startapp=c_${PUBLIC}_${CODE}`,
    );
  });
});
