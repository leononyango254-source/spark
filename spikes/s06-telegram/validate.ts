import { createHmac, timingSafeEqual } from "node:crypto";

export type ValidateResult =
  | { ok: true; user: TelegramUser | null; authDate: number; hash: string }
  | { ok: false; reason: string };

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export const DEFAULT_MAX_AGE_SECONDS = 300;

export function buildSecretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

export function dataCheckString(params: URLSearchParams, exclude: string[] = ["hash"]): string {
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (exclude.includes(k)) continue;
    pairs.push(`${k}=${v}`);
  }
  return pairs.sort().join("\n");
}

export function signInitData(entries: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(entries);
  const secret = buildSecretKey(botToken);
  const hash = createHmac("sha256", secret).update(dataCheckString(params)).digest("hex");
  params.append("hash", hash);
  return params.toString();
}

export function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: number } = {},
): ValidateResult {
  const maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  if (!providedHash) return { ok: false, reason: "missing_hash" };

  const secret = buildSecretKey(botToken);
  const expectedHash = createHmac("sha256", secret)
    .update(dataCheckString(params))
    .digest("hex");

  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(providedHash.toLowerCase(), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { ok: false, reason: "missing_auth_date" };
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { ok: false, reason: "invalid_auth_date" };
  if (now - authDate > maxAgeSeconds) return { ok: false, reason: "expired" };
  if (authDate - now > 60) return { ok: false, reason: "future_auth_date" };

  let user: TelegramUser | null = null;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      return { ok: false, reason: "invalid_user_json" };
    }
  }

  return { ok: true, user, authDate, hash: expectedHash };
}

const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);
const RESTRICTED_ACCEPTED_IF = "is_member";

export function isAcceptedMembership(member: {
  status: string;
  is_member?: boolean;
}): boolean {
  if (MEMBER_STATUSES.has(member.status)) return true;
  if (member.status === "restricted") return member[RESTRICTED_ACCEPTED_IF] === true;
  return false;
}
