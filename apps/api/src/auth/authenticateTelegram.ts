import { createSession, type Db, type UserRow, upsertUserByTelegramId } from "@spark/db";
import { validateInitData } from "@spark/telegram";
import { generateSessionToken } from "./token";

export interface AuthResult {
  token: string;
  expiresAt: Date;
  user: UserRow;
}

export type AuthOutcome = { ok: true; result: AuthResult } | { ok: false; reason: string };

export async function authenticateTelegram(
  db: Db,
  input: { initData: string; botToken: string; sessionTtlSeconds: number; now?: number },
): Promise<AuthOutcome> {
  const validation = validateInitData(
    input.initData,
    input.botToken,
    input.now === undefined ? {} : { now: input.now },
  );
  if (!validation.ok) return { ok: false, reason: validation.reason };
  if (!validation.user) return { ok: false, reason: "missing_user" };

  const user = await upsertUserByTelegramId(db, {
    telegramUserId: BigInt(validation.user.id),
    username: validation.user.username ?? null,
    firstName: validation.user.first_name ?? null,
    lastName: validation.user.last_name ?? null,
    languageCode: validation.user.language_code ?? null,
  });

  const { token, tokenHash } = generateSessionToken();
  const nowSeconds = input.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = new Date((nowSeconds + input.sessionTtlSeconds) * 1000);
  await createSession(db, { userId: user.id, tokenHash, expiresAt });

  return { ok: true, result: { token, expiresAt, user } };
}
