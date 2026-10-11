import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Mini App `initData` validation. Never trust `initDataUnsafe` (PRD §80).
 * Verified in Phase 0 (docs/spikes/S0-6-telegram.md).
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { readonly ok: true; readonly user: TelegramUser | null; readonly authDate: number }
  | { readonly ok: false; readonly reason: InitDataReason };

export type InitDataReason =
  | "missing_hash"
  | "bad_hash"
  | "missing_auth_date"
  | "invalid_auth_date"
  | "expired"
  | "future_auth_date"
  | "invalid_user_json";

export const DEFAULT_MAX_AGE_SECONDS = 300;

export function buildSecretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/** Sorted `k=v` pairs joined by `\n`, excluding the given keys (Telegram spec). */
export function dataCheckString(
  params: URLSearchParams,
  exclude: readonly string[] = ["hash"],
): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (exclude.includes(key)) continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join("\n");
}

/** Test/dev helper: produce a signed initData string for a bot token. */
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
): InitDataResult {
  const maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  if (!providedHash) return { ok: false, reason: "missing_hash" };

  const secret = buildSecretKey(botToken);
  const expectedHash = createHmac("sha256", secret).update(dataCheckString(params)).digest("hex");

  const expected = Buffer.from(expectedHash, "hex");
  const provided = Buffer.from(providedHash.toLowerCase(), "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
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

  return { ok: true, user, authDate };
}
