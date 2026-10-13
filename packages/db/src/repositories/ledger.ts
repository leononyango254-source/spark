import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type LedgerEntryRow, ledgerEntries, type NewLedgerEntryRow } from "../schema";

export async function appendLedgerEntry(
  db: Db,
  input: {
    campaignId: string;
    rewardId?: string | null;
    entryType: LedgerEntryRow["entryType"];
    amountMicroUsdc: bigint;
    direction: 1 | -1;
    idempotencyKey: string;
    reference?: string | null;
  },
): Promise<LedgerEntryRow> {
  const values: NewLedgerEntryRow = {
    campaignId: input.campaignId,
    rewardId: input.rewardId ?? null,
    entryType: input.entryType,
    amountMicroUsdc: input.amountMicroUsdc,
    direction: input.direction,
    idempotencyKey: input.idempotencyKey,
    reference: input.reference ?? null,
  };
  const [row] = await db.insert(ledgerEntries).values(values).onConflictDoNothing().returning();
  if (row) return row;
  return (await findLedgerEntryByIdempotencyKey(db, input.idempotencyKey))!;
}

export async function findLedgerEntryByIdempotencyKey(
  db: Db,
  idempotencyKey: string,
): Promise<LedgerEntryRow | null> {
  const [row] = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

export async function listLedgerEntriesByCampaign(
  db: Db,
  campaignId: string,
): Promise<LedgerEntryRow[]> {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.campaignId, campaignId));
}
