import type { MicroUsdc } from "@spark/domain";

/**
 * Append-only ledger entry types (PRD §40). The ledger and the on-chain
 * `campaignBalance` are the authorities; campaign money columns are derived caches.
 */
export const LEDGER_ENTRY_TYPES = [
  "CAMPAIGN_FUNDED",
  "REWARD_PAYOUT",
  "REFERRAL_PAYOUT",
  "CAMPAIGN_REFUND",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntry {
  readonly id: string;
  readonly campaignId: string;
  readonly type: LedgerEntryType;
  readonly amountMicroUsdc: MicroUsdc;
  readonly idempotencyKey: string;
  readonly transactionHash: string | null;
  readonly createdAt: Date;
}

/** Direction sign for balance aggregation. */
export const LEDGER_SIGN: Record<LedgerEntryType, 1 | -1> = {
  CAMPAIGN_FUNDED: 1,
  REWARD_PAYOUT: -1,
  REFERRAL_PAYOUT: -1,
  CAMPAIGN_REFUND: -1,
};
