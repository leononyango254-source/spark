import type { MicroUsdc } from "@spark/domain";

/**
 * Append-only ledger entry types (PRD §40). The ledger and the on-chain
 * `campaignBalance` are the authorities; campaign money columns are derived caches.
 */
export const LEDGER_ENTRY_TYPES = [
  "CAMPAIGN_FUNDING",
  "USER_REWARD",
  "REFERRAL_REWARD",
  "CAMPAIGN_REFUND",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntry {
  readonly id: string;
  readonly campaignId: string;
  readonly rewardId: string | null;
  readonly type: LedgerEntryType;
  readonly amountMicroUsdc: MicroUsdc;
  readonly direction: 1 | -1;
  readonly reference: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
}

/** Direction sign for balance aggregation. */
export const LEDGER_DIRECTION: Record<LedgerEntryType, 1 | -1> = {
  CAMPAIGN_FUNDING: 1,
  USER_REWARD: -1,
  REFERRAL_REWARD: -1,
  CAMPAIGN_REFUND: -1,
};
