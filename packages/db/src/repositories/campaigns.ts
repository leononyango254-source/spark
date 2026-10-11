import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { campaigns, type CampaignRow, type NewCampaignRow } from "../schema";

export async function createCampaign(db: Db, input: NewCampaignRow): Promise<CampaignRow> {
  const [row] = await db.insert(campaigns).values(input).returning();
  return row!;
}

export async function findCampaignByPublicId(
  db: Db,
  publicId: string,
): Promise<CampaignRow | null> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.publicId, publicId))
    .limit(1);
  return row ?? null;
}