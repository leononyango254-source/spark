import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { chainCursors } from "../schema";

export async function getCursor(db: Db, chainId: number, contractAddress: string): Promise<bigint> {
  const [row] = await db
    .select({ lastBlockNumber: chainCursors.lastBlockNumber })
    .from(chainCursors)
    .where(
      and(eq(chainCursors.chainId, chainId), eq(chainCursors.contractAddress, contractAddress)),
    )
    .limit(1);
  return row?.lastBlockNumber ?? 0n;
}

export async function setCursor(
  db: Db,
  chainId: number,
  contractAddress: string,
  lastBlockNumber: bigint,
): Promise<void> {
  await db
    .insert(chainCursors)
    .values({ chainId, contractAddress, lastBlockNumber })
    .onConflictDoUpdate({
      target: [chainCursors.chainId, chainCursors.contractAddress],
      set: { lastBlockNumber, updatedAt: new Date() },
    });
}
