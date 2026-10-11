import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { transactionStatus, transactionType } from "./enums";
import { campaigns } from "./campaigns";
import { rewards } from "./rewards";

export const blockchainTransactions = pgTable(
  "blockchain_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rewardId: uuid("reward_id").references(() => rewards.id),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull().unique(),
    transactionType: transactionType("transaction_type").notNull(),
    status: transactionStatus("status").notNull().default("SUBMITTED"),
    nonce: bigint("nonce", { mode: "bigint" }),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("blockchain_transactions_campaign_id_idx").on(t.campaignId),
    index("blockchain_transactions_reward_id_idx").on(t.rewardId),
  ],
);

export type BlockchainTransactionRow = typeof blockchainTransactions.$inferSelect;
export type NewBlockchainTransactionRow = typeof blockchainTransactions.$inferInsert;