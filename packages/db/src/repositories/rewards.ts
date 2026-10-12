import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import type { NewRewardRow, RewardRow } from "../schema";
import { rewards } from "../schema";

export async function nextRewardNonce(db: Db): Promise<bigint> {
  const result = await db.execute(sql`SELECT nextval('reward_nonce_seq') AS nextval`);
  const row = (result.rows as Array<{ nextval: string | number }>)[0];
  return BigInt(row!.nextval);
}

export async function createReward(db: Db, input: NewRewardRow): Promise<RewardRow> {
  const [row] = await db.insert(rewards).values(input).returning();
  return row!;
}

export async function findRewardById(db: Db, id: string): Promise<RewardRow | null> {
  const [row] = await db.select().from(rewards).where(eq(rewards.id, id)).limit(1);
  return row ?? null;
}

export async function findRewardByType(
  db: Db,
  campaignId: string,
  participationId: string,
  rewardType: RewardRow["rewardType"],
): Promise<RewardRow | null> {
  const [row] = await db
    .select()
    .from(rewards)
    .where(
      and(
        eq(rewards.campaignId, campaignId),
        eq(rewards.participationId, participationId),
        eq(rewards.rewardType, rewardType),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listSettleableRewards(db: Db, limit: number): Promise<RewardRow[]> {
  const statuses = ["AUTHORIZED", "RETRYING"] as const;
  return db
    .select()
    .from(rewards)
    .where(and(inArray(rewards.status, statuses), gt(rewards.authorizationExpiresAt, new Date())))
    .orderBy(asc(rewards.createdAt))
    .limit(limit);
}

export async function updateRewardStatus(
  db: Db,
  id: string,
  status: RewardRow["status"],
  extra: Partial<
    Pick<RewardRow, "transactionHash" | "submittedAt" | "confirmedAt" | "failedAt">
  > = {},
): Promise<RewardRow> {
  const [row] = await db
    .update(rewards)
    .set({ status, ...extra })
    .where(eq(rewards.id, id))
    .returning();
  return row!;
}

export async function countRewardsByStatus(
  db: Db,
  campaignId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: rewards.status })
    .from(rewards)
    .where(eq(rewards.campaignId, campaignId));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}
