import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ParticipationRow, participations } from "../schema";

export async function createParticipation(
  db: Db,
  input: { campaignId: string; userId: string; taskId: string },
): Promise<ParticipationRow> {
  const [row] = await db.insert(participations).values(input).returning();
  return row!;
}

export async function findParticipation(
  db: Db,
  campaignId: string,
  userId: string,
): Promise<ParticipationRow | null> {
  const [row] = await db
    .select()
    .from(participations)
    .where(and(eq(participations.campaignId, campaignId), eq(participations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function findParticipationById(db: Db, id: string): Promise<ParticipationRow | null> {
  const [row] = await db.select().from(participations).where(eq(participations.id, id)).limit(1);
  return row ?? null;
}

export async function setParticipationReferrer(
  db: Db,
  id: string,
  input: { referrerUserId: string; referralCode: string },
): Promise<ParticipationRow> {
  const [row] = await db
    .update(participations)
    .set({
      referrerUserId: input.referrerUserId,
      referralCodeUsed: input.referralCode,
      updatedAt: new Date(),
    })
    .where(eq(participations.id, id))
    .returning();
  return row!;
}

export async function updateParticipationStatus(
  db: Db,
  id: string,
  status: ParticipationRow["status"],
  extra: Partial<Pick<ParticipationRow, "verifiedAt" | "rewardId">> = {},
): Promise<ParticipationRow> {
  const [row] = await db
    .update(participations)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(participations.id, id))
    .returning();
  return row!;
}
