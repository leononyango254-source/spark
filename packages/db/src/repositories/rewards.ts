import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { campaigns, type NewRewardRow, type RewardRow, rewards } from "../schema";

export async function nextRewardNonce(db: Db): Promise<bigint> {
  const result = await db.execute(sql`SELECT nextval('reward_nonce_seq') AS nextval`);
  const row = (result.rows as Array<{ nextval: string | number }>)[0];
  return BigInt(row!.nextval);
}

export async function nextRewardRef(db: Db): Promise<bigint> {
  const result = await db.execute(sql`SELECT nextval('reward_ref_seq') AS nextval`);
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

export async function findRewardByOnChainId(
  db: Db,
  onChainRewardId: bigint,
): Promise<RewardRow | null> {
  const [row] = await db
    .select()
    .from(rewards)
    .where(eq(rewards.onChainRewardId, onChainRewardId))
    .limit(1);
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

export async function listSubmittedRewards(db: Db, limit: number): Promise<RewardRow[]> {
  return db
    .select()
    .from(rewards)
    .where(eq(rewards.status, "SUBMITTED"))
    .orderBy(asc(rewards.createdAt))
    .limit(limit);
}

export async function listSettleableRewards(db: Db, limit: number): Promise<RewardRow[]> {
  const statuses = ["AUTHORIZED", "RETRYING"] as const;
  const rows = await db
    .select({ reward: rewards })
    .from(rewards)
    .innerJoin(campaigns, eq(campaigns.id, rewards.campaignId))
    .where(
      and(
        inArray(rewards.status, statuses),
        gt(rewards.authorizationExpiresAt, new Date()),
        isNotNull(campaigns.onChainCampaignId),
      ),
    )
    .orderBy(asc(rewards.createdAt))
    .limit(limit);
  return rows.map((r) => r.reward);
}

export async function updateRewardStatus(
  db: Db,
  id: string,
  status: RewardRow["status"],
  extra: Partial<
    Pick<
      RewardRow,
      "transactionHash" | "submittedAt" | "confirmedAt" | "paidAt" | "failedAt" | "failureReason"
    >
  > = {},
): Promise<RewardRow> {
  const [row] = await db
    .update(rewards)
    .set({ status, ...extra })
    .where(eq(rewards.id, id))
    .returning();
  return row!;
}

export async function setRewardRecipient(
  db: Db,
  rewardId: string,
  recipientWallet: string,
): Promise<void> {
  await db.update(rewards).set({ recipientWallet }).where(eq(rewards.id, rewardId));
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
