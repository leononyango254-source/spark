import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { tasks, type TaskRow } from "../schema";

export async function findMembershipTask(db: Db, campaignId: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.campaignId, campaignId), eq(tasks.type, "TELEGRAM_CHANNEL_MEMBERSHIP")))
    .limit(1);
  return row ?? null;
}