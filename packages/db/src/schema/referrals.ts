import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { referralStatus } from "./enums";
import { campaigns } from "./campaigns";
import { users } from "./users";

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id),
    referredUserId: uuid("referred_user_id")
      .notNull()
      .references(() => users.id),
    referralCode: text("referral_code").notNull(),
    status: referralStatus("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referrals_campaign_referred_unique").on(t.campaignId, t.referredUserId),
    check("referrals_no_self_referral", sql`${t.referrerUserId} <> ${t.referredUserId}`),
  ],
);

export type ReferralRow = typeof referrals.$inferSelect;
export type NewReferralRow = typeof referrals.$inferInsert;