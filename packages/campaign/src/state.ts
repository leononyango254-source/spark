export const CAMPAIGN_STATES = [
  "DRAFT",
  "FUNDING",
  "FUNDED",
  "ACTIVE",
  "PAUSED",
  "CLOSED",
  "FUNDING_FAILED",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const CAMPAIGN_TRANSITIONS: Record<CampaignState, readonly CampaignState[]> = {
  DRAFT: ["FUNDING"],
  FUNDING: ["FUNDED", "FUNDING_FAILED"],
  FUNDED: ["ACTIVE", "FUNDING_FAILED"],
  ACTIVE: ["PAUSED", "CLOSED", "FUNDING_FAILED"],
  PAUSED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
  FUNDING_FAILED: [],
};

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function assertCampaignTransition(from: CampaignState, to: CampaignState): void {
  if (!canTransitionCampaign(from, to)) {
    throw new CampaignError(`invalid campaign transition: ${from} -> ${to}`);
  }
}

export class CampaignError extends Error {
  override readonly name = "CampaignError";
}
