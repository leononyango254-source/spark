import { randomBytes } from "node:crypto";

export const REFERRAL_CODE_PATTERN = /^[0-9a-z]{8}$/;

export function generateReferralCode(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) {
    out += alphabet[byte & 31];
  }
  return out;
}
