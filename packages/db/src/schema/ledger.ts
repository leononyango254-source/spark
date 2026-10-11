import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ledgerEntryType } from "./enums";
import { campaigns } from "./campaigns";
import { rewards } from "./rewards";

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    rewardId: uuid("reward_id").references(() => rewards.id),
    entryType: ledgerEntryType("entry_type").notNull(),
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    direction: smallint("direction").notNull(),
    reference: text("reference"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_campaign_id_idx").on(t.campaignId),
    check("ledger_entries_amount_positive", sql`${t.amountMicroUsdc} > 0`),
    check("ledger_entries_direction_valid", sql`${t.direction} IN (1, -1)`),
  ],
);

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntryRow = typeof ledgerEntries.$inferInsert;