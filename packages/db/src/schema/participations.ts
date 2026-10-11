import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { participationStatus } from "./enums";
import { tasks } from "./tasks";
import { users } from "./users";

export const participations = pgTable(
  "participations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    referralCodeUsed: text("referral_code_used"),
    referrerUserId: uuid("referrer_user_id").references(() => users.id),
    status: participationStatus("status").notNull().default("STARTED"),
    rewardId: uuid("reward_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("participations_campaign_user_unique").on(t.campaignId, t.userId),
    index("participations_campaign_id_idx").on(t.campaignId),
    check(
      "participations_no_self_referral",
      sql`${t.referrerUserId} IS NULL OR ${t.referrerUserId} <> ${t.userId}`,
    ),
  ],
);

export type ParticipationRow = typeof participations.$inferSelect;
export type NewParticipationRow = typeof participations.$inferInsert;
