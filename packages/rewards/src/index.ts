/**
 * Reward + participation state machines (PRD §20/§33).
 * These transitions are mirrored in the database with conditional updates for idempotency.
 */

export const PARTICIPATION_STATES = [
  "STARTED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "WALLET_REQUIRED",
  "REWARD_PENDING",
  "REWARDED",
] as const;

export type ParticipationState = (typeof PARTICIPATION_STATES)[number];

export const REWARD_STATES = ["ELIGIBLE", "AUTHORIZED", "SUBMITTED", "CONFIRMED", "PAID"] as const;

export type RewardState = (typeof REWARD_STATES)[number];

export const REWARD_TRANSITIONS: Record<RewardState, readonly RewardState[]> = {
  ELIGIBLE: ["AUTHORIZED"],
  AUTHORIZED: ["SUBMITTED"],
  SUBMITTED: ["CONFIRMED"],
  CONFIRMED: ["PAID"],
  PAID: [],
};

export function canTransitionReward(from: RewardState, to: RewardState): boolean {
  return REWARD_TRANSITIONS[from].includes(to);
}

export function assertRewardTransition(from: RewardState, to: RewardState): void {
  if (!canTransitionReward(from, to)) {
    throw new Error(`invalid reward transition: ${from} -> ${to}`);
  }
}

/** Wallet association is frozen once the reward leaves ELIGIBLE. */
export function isWalletMutable(rewardState: RewardState): boolean {
  return rewardState === "ELIGIBLE";
}
