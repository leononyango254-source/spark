import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { users } from "./users";

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referral_codes_campaign_code_unique").on(t.campaignId, t.code),
    unique("referral_codes_campaign_referrer_unique").on(t.campaignId, t.referrerUserId),
  ],
);

export type ReferralCodeRow = typeof referralCodes.$inferSelect;
export type NewReferralCodeRow = typeof referralCodes.$inferInsert;
