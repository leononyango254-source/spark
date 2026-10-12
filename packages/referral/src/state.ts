export const REFERRAL_STATES = ["ATTRIBUTED", "QUALIFIED", "REWARD_PENDING", "PAID", "REJECTED"] as const;

export type ReferralState = (typeof REFERRAL_STATES)[number];

export const REFERRAL_TRANSITIONS: Record<ReferralState, readonly ReferralState[]> = {
  ATTRIBUTED: ["QUALIFIED", "REJECTED"],
  QUALIFIED: ["REWARD_PENDING", "REJECTED"],
  REWARD_PENDING: ["PAID", "REJECTED"],
  PAID: [],
  REJECTED: [],
};

export function canTransitionReferral(from: ReferralState, to: ReferralState): boolean {
  return REFERRAL_TRANSITIONS[from].includes(to);
}

export function assertReferralTransition(from: ReferralState, to: ReferralState): void {
  if (!canTransitionReferral(from, to)) {
    throw new ReferralError(`invalid referral transition: ${from} -> ${to}`);
  }
}

export class ReferralError extends Error {
  override readonly name = "ReferralError";
}