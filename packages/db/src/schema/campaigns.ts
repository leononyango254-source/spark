import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignStatus } from "./enums";
import { users } from "./users";

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: text("public_id").notNull().unique(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    status: campaignStatus("status").notNull().default("DRAFT"),
    chainId: integer("chain_id").notNull(),
    escrowAddress: text("escrow_address"),
    onChainCampaignId: bigint("on_chain_campaign_id", { mode: "bigint" }),
    rewardMicroUsdc: bigint("reward_micro_usdc", { mode: "bigint" }).notNull(),
    referralRewardMicroUsdc: bigint("referral_reward_micro_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    budgetMicroUsdc: bigint("budget_micro_usdc", { mode: "bigint" }).notNull(),
    balanceMicroUsdc: bigint("balance_micro_usdc", { mode: "bigint" }).notNull().default(0n),
    targetChatId: bigint("target_chat_id", { mode: "bigint" }),
    targetChatUsername: text("target_chat_username"),
    deadline: timestamp("deadline", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campaigns_creator_id_idx").on(t.creatorId),
    index("campaigns_status_idx").on(t.status),
    check("campaigns_reward_positive", sql`${t.rewardMicroUsdc} > 0`),
    check("campaigns_referral_reward_non_negative", sql`${t.referralRewardMicroUsdc} >= 0`),
    check("campaigns_budget_positive", sql`${t.budgetMicroUsdc} > 0`),
    check("campaigns_balance_non_negative", sql`${t.balanceMicroUsdc} >= 0`),
    check("campaigns_reward_within_budget", sql`${t.rewardMicroUsdc} <= ${t.budgetMicroUsdc}`),
  ],
);

export type CampaignRow = typeof campaigns.$inferSelect;
export type NewCampaignRow = typeof campaigns.$inferInsert;