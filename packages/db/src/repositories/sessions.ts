import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { sessions, type SessionRow } from "../schema";

export async function createSession(
  db: Db,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<SessionRow> {
  const [row] = await db.insert(sessions).values(input).returning();
  return row!;
}

export async function findActiveSessionByTokenHash(
  db: Db,
  tokenHash: string,
  now: Date = new Date(),
): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function revokeSession(db: Db, id: string, now: Date = new Date()): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, id));
}