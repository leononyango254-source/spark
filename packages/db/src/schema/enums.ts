import { pgEnum } from "drizzle-orm/pg-core";

export const campaignStatus = pgEnum("campaign_status", [
  "DRAFT",
  "FUNDING",
  "FUNDED",
  "ACTIVE",
  "PAUSED",
  "CLOSED",
  "FUNDING_FAILED",
]);

export const participationStatus = pgEnum("participation_status", [
  "STARTED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "WALLET_REQUIRED",
  "REWARD_PENDING",
  "REWARDED",
  "REJECTED",
]);

export const rewardType = pgEnum("reward_type", ["USER_COMPLETION", "REFERRAL"]);

export const rewardStatus = pgEnum("reward_status", [
  "ELIGIBLE",
  "AUTHORIZED",
  "SUBMITTED",
  "CONFIRMED",
  "PAID",
  "SUBMISSION_FAILED",
  "RETRYING",
  "FAILED",
]);

export const referralStatus = pgEnum("referral_status", [
  "PENDING",
  "REWARDED",
  "REJECTED",
  "ATTRIBUTED",
  "QUALIFIED",
  "REWARD_PENDING",
  "PAID",
]);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "CAMPAIGN_FUNDING",
  "USER_REWARD",
  "REFERRAL_REWARD",
  "CAMPAIGN_REFUND",
]);

export const transactionType = pgEnum("blockchain_transaction_type", [
  "CAMPAIGN_CREATE",
  "CAMPAIGN_FUND",
  "REWARD_PAYOUT",
  "CAMPAIGN_REFUND",
]);

export const transactionStatus = pgEnum("blockchain_transaction_status", [
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "DROPPED",
]);

export const taskType = pgEnum("task_type", ["TELEGRAM_CHANNEL_MEMBERSHIP"]);
