import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type CampaignEventRow, campaignEvents, type NewCampaignEventRow } from "../schema";

export async function insertEvent(
  db: Db,
  input: NewCampaignEventRow,
): Promise<CampaignEventRow | null> {
  const [row] = await db.insert(campaignEvents).values(input).onConflictDoNothing().returning();
  return row ?? null;
}

export async function existsEvent(
  db: Db,
  chainId: number,
  transactionHash: string,
  logIndex: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: campaignEvents.id })
    .from(campaignEvents)
    .where(
      and(
        eq(campaignEvents.chainId, chainId),
        eq(campaignEvents.transactionHash, transactionHash),
        eq(campaignEvents.logIndex, logIndex),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function countPaidRewardsWithoutEvent(db: Db): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM rewards r
    JOIN blockchain_transactions t ON t.reward_id = r.id AND t.status = 'CONFIRMED'
    LEFT JOIN campaign_events e ON e.transaction_hash = t.tx_hash AND e.chain_id = t.chain_id
    WHERE r.status = 'PAID' AND e.id IS NULL
  `);
  const row = (result.rows as Array<{ count: number }>)[0];
  return row?.count ?? 0;
}
