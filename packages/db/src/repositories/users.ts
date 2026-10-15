import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type UserRow, users } from "../schema";

export interface TelegramProfile {
  telegramUserId: bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}

export async function upsertUserByTelegramId(db: Db, profile: TelegramProfile): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      telegramUserId: profile.telegramUserId,
      username: profile.username ?? null,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      languageCode: profile.languageCode ?? null,
    })
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: {
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        languageCode: profile.languageCode ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function updateUserWallet(
  db: Db,
  userId: string,
  wallet: { address: string; provider: string; chainId: number },
): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({
      walletAddress: wallet.address,
      walletProvider: wallet.provider,
      walletStatus: "connected",
      walletChainId: wallet.chainId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error("updateUserWallet: no row returned");
  return row;
}

export async function clearUserWallet(db: Db, userId: string): Promise<UserRow> {
  const [row] = await db
    .update(users)
    .set({
      walletAddress: null,
      walletProvider: null,
      walletStatus: "disconnected",
      walletChainId: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error("clearUserWallet: no row returned");
  return row;
}

export async function findOrCreateUserByTelegramId(
  db: Db,
  telegramUserId: bigint,
): Promise<UserRow> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramUserId, telegramUserId))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(users)
    .values({ telegramUserId })
    .onConflictDoNothing({ target: users.telegramUserId })
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.telegramUserId, telegramUserId))
    .limit(1);
  return row!;
}
