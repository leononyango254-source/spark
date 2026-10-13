import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  type BlockchainTransactionRow,
  blockchainTransactions,
  type NewBlockchainTransactionRow,
} from "../schema";

export async function createTransaction(
  db: Db,
  input: NewBlockchainTransactionRow,
): Promise<BlockchainTransactionRow> {
  const [row] = await db.insert(blockchainTransactions).values(input).returning();
  return row!;
}

export async function findTransactionByHash(
  db: Db,
  txHash: string,
): Promise<BlockchainTransactionRow | null> {
  const [row] = await db
    .select()
    .from(blockchainTransactions)
    .where(eq(blockchainTransactions.txHash, txHash))
    .limit(1);
  return row ?? null;
}

export async function listTransactionsByRewardId(
  db: Db,
  rewardId: string,
): Promise<BlockchainTransactionRow[]> {
  return db
    .select()
    .from(blockchainTransactions)
    .where(eq(blockchainTransactions.rewardId, rewardId));
}

export async function listSubmittedTransactions(
  db: Db,
  limit: number,
): Promise<BlockchainTransactionRow[]> {
  return db
    .select()
    .from(blockchainTransactions)
    .where(eq(blockchainTransactions.status, "SUBMITTED"))
    .limit(limit);
}

export async function updateTransactionStatus(
  db: Db,
  txHash: string,
  status: BlockchainTransactionRow["status"],
  extra: Partial<
    Pick<
      BlockchainTransactionRow,
      "blockNumber" | "errorCode" | "errorMessage" | "confirmedAt" | "failureReason" | "lastCheckedAt"
    >
  > = {},
): Promise<BlockchainTransactionRow> {
  const [row] = await db
    .update(blockchainTransactions)
    .set({ status, ...extra })
    .where(eq(blockchainTransactions.txHash, txHash))
    .returning();
  return row!;
}

export async function incrementAttempts(db: Db, txHash: string): Promise<number> {
  const [row] = await db
    .update(blockchainTransactions)
    .set({ attempts: sql`${blockchainTransactions.attempts} + 1`, lastCheckedAt: new Date() })
    .where(eq(blockchainTransactions.txHash, txHash))
    .returning();
  return row?.attempts ?? 0;
}

export async function findTransactionByRewardId(
  db: Db,
  rewardId: string,
): Promise<BlockchainTransactionRow | null> {
  const [row] = await db
    .select()
    .from(blockchainTransactions)
    .where(and(eq(blockchainTransactions.rewardId, rewardId)))
    .limit(1);
  return row ?? null;
}