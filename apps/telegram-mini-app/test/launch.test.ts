import { describe, expect, it } from "vitest";
import { parseStartParam } from "../src/launch";

describe("launch", () => {
  describe("parseStartParam", () => {
    it("parses valid startapp payload with publicId only", () => {
      const result = parseStartParam("c_abcdefghijklmnop");
      expect(result).toEqual({ publicId: "abcdefghijklmnop", referralCode: undefined });
    });

    it("parses valid startapp payload with publicId and referralCode", () => {
      const result = parseStartParam("c_abcdefghijklmnop_abcdefgh");
      expect(result).toEqual({ publicId: "abcdefghijklmnop", referralCode: "abcdefgh" });
    });

    it("returns null for payload without c_ prefix", () => {
      const result = parseStartParam("ref_abc123");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseStartParam("");
      expect(result).toBeNull();
    });

    it("returns null for oversized payload (>64 chars)", () => {
      const oversized = `c_${"a".repeat(65)}`;
      const result = parseStartParam(oversized);
      expect(result).toBeNull();
    });

    it("returns null for payload with invalid characters (uppercase)", () => {
      const result = parseStartParam("c_ABCDEFGHIJKLMNOP");
      expect(result).toBeNull();
    });

    it("returns null for payload with invalid characters (special chars)", () => {
      const result = parseStartParam("c_abc@#$");
      expect(result).toBeNull();
    });

    it("returns null for c_ with no publicId after prefix", () => {
      const result = parseStartParam("c_");
      expect(result).toBeNull();
    });

    it("returns null for publicId too short (<16 chars)", () => {
      const result = parseStartParam("c_abc");
      expect(result).toBeNull();
    });

    it("returns null for publicId too long (>32 chars)", () => {
      const result = parseStartParam(`c_${"a".repeat(33)}`);
      expect(result).toBeNull();
    });

    it("returns null for referralCode too short (<8 chars)", () => {
      const result = parseStartParam("c_abcdefghijklmnop_abc");
      expect(result).toBeNull();
    });

    it("returns null for referralCode too long (>8 chars)", () => {
      const result = parseStartParam("c_abcdefghijklmnop_abcdefghi");
      expect(result).toBeNull();
    });
  });
});
