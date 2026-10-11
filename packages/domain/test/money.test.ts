import { describe, expect, it } from "vitest";
import { MoneyError, microToUsdc, usdcToMicro } from "../src/money";

describe("money", () => {
  it("parses whole and fractional USDC", () => {
    expect(usdcToMicro("1")).toBe(1_000_000n);
    expect(usdcToMicro("12.5")).toBe(12_500_000n);
    expect(usdcToMicro("0.000001")).toBe(1n);
  });

  it("rejects more precision than USDC supports", () => {
    expect(usdcToMicro("0.0000001")).toBe(0n);
  });

  it("rejects malformed input", () => {
    expect(() => usdcToMicro("1.2.3")).toThrow(MoneyError);
    expect(() => usdcToMicro("abc")).toThrow(MoneyError);
    expect(() => usdcToMicro("")).toThrow(MoneyError);
  });

  it("round-trips formatting", () => {
    expect(microToUsdc(usdcToMicro("25.0"))).toBe("25.000000");
    expect(microToUsdc(25_000_000n as never)).toBe("25.000000");
  });

  it("handles negatives", () => {
    expect(usdcToMicro("-0.5")).toBe(-500_000n);
    expect(microToUsdc(usdcToMicro("-0.5"))).toBe("-0.500000");
  });
});
