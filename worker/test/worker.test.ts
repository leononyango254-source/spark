import { describe, expect, it } from "vitest";
import { createBoss } from "../src/index";
import { QUEUES } from "../src/queues";

describe("worker", () => {
  it("defines the required queues", () => {
    expect(Object.values(QUEUES)).toEqual(["settlement", "reconciliation"]);
  });

  it("constructs a boss instance without connecting", () => {
    const boss = createBoss("postgres://spark:spark@localhost:5432/spark");
    expect(boss).toBeDefined();
  });
});
