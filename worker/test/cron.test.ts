import { describe, expect, it } from "vitest";
import { intervalToCron } from "../src/cron";

describe("intervalToCron", () => {
  it("uses a seconds field under a minute", () => {
    expect(intervalToCron(15)).toBe("*/15 * * * * *");
  });
  it("uses a minute field for whole minutes", () => {
    expect(intervalToCron(120)).toBe("*/2 * * * *");
  });
  it("falls back to every minute", () => {
    expect(intervalToCron(90)).toBe("* * * * *");
  });
  it("rejects non-positive intervals", () => {
    expect(() => intervalToCron(0)).toThrow();
  });
});
