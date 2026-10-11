import { randomBytes } from "node:crypto";

export const PUBLIC_ID_PATTERN = /^[0-9a-z]{16,32}$/;

/** URL-safe campaign public id. 16 random bytes -> 16 chars in the lower-alphabet. */
export function generatePublicId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) {
    out += alphabet[byte & 31];
  }
  return out;
}