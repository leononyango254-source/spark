import { describe, expect, it } from "vitest";
import { generatePublicId, PUBLIC_ID_PATTERN } from "../src/publicId";

describe("generatePublicId", () => {
  it("produces a URL-safe id matching the pattern", () => {
    const id = generatePublicId();
    expect(id).toMatch(PUBLIC_ID_PATTERN);
    expect(id.length).toBeGreaterThanOrEqual(16);
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicId()));
    expect(ids.size).toBe(1000);
  });
});