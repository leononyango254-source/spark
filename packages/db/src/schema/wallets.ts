import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { users } from "./users";

export const walletAssociations = pgTable(
  "wallet_associations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("wallet_associations_campaign_user_unique").on(t.campaignId, t.userId)],
);

export type WalletAssociationRow = typeof walletAssociations.$inferSelect;
export type NewWalletAssociationRow = typeof walletAssociations.$inferInsert;