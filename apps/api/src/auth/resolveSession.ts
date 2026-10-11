import { findActiveSessionByTokenHash, findUserById, type Db, type UserRow } from "@spark/db";
import { hashToken } from "./token";

export function extractToken(headers: {
  authorization?: string | string[] | undefined;
  cookie?: string | undefined;
}): string | null {
  const auth = headers.authorization;
  const bearer = Array.isArray(auth) ? auth[0] : auth;
  if (bearer?.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();

  const cookie = headers.cookie;
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === "spark_session") return decodeURIComponent(v.join("="));
    }
  }
  return null;
}

export async function resolveSession(db: Db, token: string): Promise<UserRow | null> {
  const session = await findActiveSessionByTokenHash(db, hashToken(token));
  if (!session) return null;
  return findUserById(db, session.userId);
}