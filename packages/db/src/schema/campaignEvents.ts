import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

export const campaignEvents = pgTable(
  "campaign_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    chainId: integer("chain_id").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("campaign_events_log_unique").on(t.chainId, t.transactionHash, t.logIndex)],
);

export type CampaignEventRow = typeof campaignEvents.$inferSelect;
export type NewCampaignEventRow = typeof campaignEvents.$inferInsert;
