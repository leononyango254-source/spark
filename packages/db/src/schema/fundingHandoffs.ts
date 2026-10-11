import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

export const creatorFundingHandoffs = pgTable("creator_funding_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreatorFundingHandoffRow = typeof creatorFundingHandoffs.$inferSelect;
export type NewCreatorFundingHandoffRow = typeof creatorFundingHandoffs.$inferInsert;