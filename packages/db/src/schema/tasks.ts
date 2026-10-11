import { jsonb, bigint, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { taskType } from "./enums";
import { campaigns } from "./campaigns";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    type: taskType("type").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    rewardMicroUsdc: bigint("reward_micro_usdc", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tasks_campaign_type_unique").on(t.campaignId, t.type)],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;