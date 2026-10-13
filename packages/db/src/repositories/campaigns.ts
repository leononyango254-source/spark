import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type CampaignRow, campaigns, type NewCampaignRow } from "../schema";

export async function createCampaign(db: Db, input: NewCampaignRow): Promise<CampaignRow> {
  const [row] = await db.insert(campaigns).values(input).returning();
  return row!;
}

export async function findCampaignByPublicId(
  db: Db,
  publicId: string,
): Promise<CampaignRow | null> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.publicId, publicId)).limit(1);
  return row ?? null;
}

export async function findCampaignById(db: Db, id: string): Promise<CampaignRow | null> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row ?? null;
}

export async function listCampaignsByCreator(db: Db, creatorId: string): Promise<CampaignRow[]> {
  return db.select().from(campaigns).where(eq(campaigns.creatorId, creatorId));
}

export async function updateCampaignStatus(
  db: Db,
  id: string,
  status: CampaignRow["status"],
  extra: Partial<Pick<CampaignRow, "activatedAt" | "closedAt">> = {},
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function updateCampaignConfig(
  db: Db,
  id: string,
  patch: Partial<CampaignRow>,
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function setCampaignFunded(
  db: Db,
  id: string,
  amountMicroUsdc: bigint,
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ balanceMicroUsdc: amountMicroUsdc, status: "FUNDED", updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function reserveCampaignBudget(
  db: Db,
  campaignId: string,
  amountMicroUsdc: bigint,
): Promise<boolean> {
  const rows = await db
    .update(campaigns)
    .set({
      balanceMicroUsdc: sql`${campaigns.balanceMicroUsdc} - ${amountMicroUsdc}`,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), gte(campaigns.balanceMicroUsdc, amountMicroUsdc)))
    .returning({ id: campaigns.id });
  return rows.length > 0;
}

export async function incrementParticipantCount(db: Db, campaignId: string): Promise<boolean> {
  const rows = await db
    .update(campaigns)
    .set({
      participantCount: sql`${campaigns.participantCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(campaigns.id, campaignId),
        sql`(${campaigns.maxParticipants} IS NULL OR ${campaigns.participantCount} < ${campaigns.maxParticipants})`,
      ),
    )
    .returning({ id: campaigns.id });
  return rows.length > 0;
}
