import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { referralCodes, users } from "../schema";

export async function getOrCreateReferralCode(
  db: Db,
  input: { campaignId: string; referrerUserId: string; generate: () => string },
): Promise<string> {
  const [existing] = await db
    .select({ code: referralCodes.code })
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.campaignId, input.campaignId),
        eq(referralCodes.referrerUserId, input.referrerUserId),
      ),
    )
    .limit(1);
  if (existing) return existing.code;

  await db
    .insert(referralCodes)
    .values({
      campaignId: input.campaignId,
      referrerUserId: input.referrerUserId,
      code: input.generate(),
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ code: referralCodes.code })
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.campaignId, input.campaignId),
        eq(referralCodes.referrerUserId, input.referrerUserId),
      ),
    )
    .limit(1);
  return row!.code;
}

export async function findReferrerByCode(
  db: Db,
  campaignId: string,
  code: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(referralCodes)
    .innerJoin(users, eq(users.id, referralCodes.referrerUserId))
    .where(and(eq(referralCodes.campaignId, campaignId), eq(referralCodes.code, code)))
    .limit(1);
  return row ?? null;
}
