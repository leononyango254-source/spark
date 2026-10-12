import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type TaskRow, tasks } from "../schema";

export async function createMembershipTask(
  db: Db,
  input: { campaignId: string; rewardMicroUsdc: bigint; chatId: string },
): Promise<TaskRow> {
  const [row] = await db
    .insert(tasks)
    .values({
      campaignId: input.campaignId,
      type: "TELEGRAM_CHANNEL_MEMBERSHIP",
      rewardMicroUsdc: input.rewardMicroUsdc,
      config: { chat_id: input.chatId },
    })
    .returning();
  return row!;
}

export async function findMembershipTask(db: Db, campaignId: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.campaignId, campaignId), eq(tasks.type, "TELEGRAM_CHANNEL_MEMBERSHIP")))
    .limit(1);
  return row ?? null;
}
