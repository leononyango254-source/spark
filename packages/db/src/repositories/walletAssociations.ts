import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { type WalletAssociationRow, walletAssociations } from "../schema";

export async function findActiveWalletByCampaignAndUser(
  db: Db,
  campaignId: string,
  userId: string,
): Promise<WalletAssociationRow | null> {
  const [row] = await db
    .select()
    .from(walletAssociations)
    .where(
      and(
        eq(walletAssociations.campaignId, campaignId),
        eq(walletAssociations.userId, userId),
        isNull(walletAssociations.frozenAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertWalletAssociation(
  db: Db,
  input: { campaignId: string; userId: string; address: string; normalizedAddress: string },
): Promise<WalletAssociationRow> {
  const [row] = await db
    .insert(walletAssociations)
    .values(input)
    .onConflictDoUpdate({
      target: [walletAssociations.campaignId, walletAssociations.userId],
      set: {
        address: input.address,
        normalizedAddress: input.normalizedAddress,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("upsertWalletAssociation: no row returned");
  return row;
}
