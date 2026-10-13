import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  languageCode: text("language_code"),
  walletAddress: text("wallet_address"),
  walletProvider: text("wallet_provider"),
  walletStatus: text("wallet_status"),
  walletChainId: integer("wallet_chain_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
