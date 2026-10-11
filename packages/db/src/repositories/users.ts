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
