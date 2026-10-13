import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ReferralRow, referrals } from "../schema";

export async function upsertReferralAttribution(
  db: Db,
  input: {
    campaignId: string;
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
  },
): Promise<ReferralRow | null> {
  if (input.referrerUserId === input.referredUserId) return null;
  await db
    .insert(referrals)
    .values({
      campaignId: input.campaignId,
      referrerUserId: input.referrerUserId,
      referredUserId: input.referredUserId,
      referralCode: input.referralCode,
      status: "ATTRIBUTED",
    })
    .onConflictDoNothing();
  return findReferral(db, input.campaignId, input.referredUserId);
}

export async function findReferral(
  db: Db,
  campaignId: string,
  referredUserId: string,
): Promise<ReferralRow | null> {
  const [row] = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.campaignId, campaignId), eq(referrals.referredUserId, referredUserId)))
    .limit(1);
  return row ?? null;
}

export async function updateReferralStatus(
  db: Db,
  id: string,
  status: ReferralRow["status"],
  extra: Partial<Pick<ReferralRow, "qualifiedAt">> = {},
): Promise<ReferralRow> {
  const [row] = await db
    .update(referrals)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(referrals.id, id))
    .returning();
  return row!;
}

export async function countReferralsByStatus(
  db: Db,
  campaignId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: referrals.status })
    .from(referrals)
    .where(eq(referrals.campaignId, campaignId));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}
