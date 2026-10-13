import { sql } from "drizzle-orm";
import { bigint, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const chainCursors = pgTable(
  "chain_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    lastBlockNumber: bigint("last_block_number", { mode: "bigint" }).notNull().default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("chain_cursors_chain_contract_unique").on(t.chainId, t.contractAddress)],
);

export type ChainCursorRow = typeof chainCursors.$inferSelect;
export type NewChainCursorRow = typeof chainCursors.$inferInsert;
