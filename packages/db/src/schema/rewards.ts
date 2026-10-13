import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { rewardStatus, rewardType } from "./enums";
import { participations } from "./participations";
import { users } from "./users";

export const rewards = pgTable(
  "rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    participationId: uuid("participation_id").references(() => participations.id),
    rewardType: rewardType("reward_type").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    recipientWallet: text("recipient_wallet"),
    onChainRewardId: bigint("on_chain_reward_id", { mode: "bigint" }).notNull().unique(),
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    authorizationNonce: bigint("authorization_nonce", { mode: "bigint" }).notNull().unique(),
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: rewardStatus("status").notNull().default("ELIGIBLE"),
    failureReason: text("failure_reason"),
    chainId: integer("chain_id").notNull(),
    transactionHash: text("transaction_hash"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("rewards_campaign_participation_type_unique").on(
      t.campaignId,
      t.participationId,
      t.rewardType,
    ),
    index("rewards_campaign_id_idx").on(t.campaignId),
    index("rewards_recipient_user_id_idx").on(t.recipientUserId),
    check("rewards_amount_positive", sql`${t.amountMicroUsdc} > 0`),
  ],
);

export type RewardRow = typeof rewards.$inferSelect;
export type NewRewardRow = typeof rewards.$inferInsert;
