import { describe, expect, it } from "vitest";
import { assertRewardTransition, canTransitionReward, isWalletMutable } from "../src/index";

describe("reward state machine", () => {
  it("allows the canonical path", () => {
    expect(canTransitionReward("ELIGIBLE", "AUTHORIZED")).toBe(true);
    expect(canTransitionReward("AUTHORIZED", "SUBMITTED")).toBe(true);
    expect(canTransitionReward("SUBMITTED", "CONFIRMED")).toBe(true);
    expect(canTransitionReward("CONFIRMED", "PAID")).toBe(true);
  });

  it("forbids skipping and reversing", () => {
    expect(canTransitionReward("ELIGIBLE", "PAID")).toBe(false);
    expect(canTransitionReward("PAID", "ELIGIBLE")).toBe(false);
    expect(() => assertRewardTransition("ELIGIBLE", "SUBMITTED")).toThrow();
  });

  it("frees the wallet only while ELIGIBLE", () => {
    expect(isWalletMutable("ELIGIBLE")).toBe(true);
    expect(isWalletMutable("AUTHORIZED")).toBe(false);
  });
});
