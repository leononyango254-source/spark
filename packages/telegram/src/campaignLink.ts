const PUBLIC_PART = "[0-9a-z]{16,32}";
const CODE_PART = "[0-9a-z]{8}";

export function parseStartapp(
  payload: string,
): { kind: "campaign"; publicId: string; referralCode?: string } | null {
  if (payload.length > 64) return null;
  const match = new RegExp(`^c_(${PUBLIC_PART})(?:_(${CODE_PART}))?$`).exec(payload);
  if (!match) return null;
  const referralCode = match[2];
  return referralCode === undefined
    ? { kind: "campaign", publicId: match[1]! }
    : { kind: "campaign", publicId: match[1]!, referralCode };
}

export function buildStartapp(publicId: string, referralCode?: string): string {
  if (!new RegExp(`^${PUBLIC_PART}$`).test(publicId)) throw new RangeError("invalid publicId");
  if (referralCode !== undefined && !new RegExp(`^${CODE_PART}$`).test(referralCode)) {
    throw new RangeError("invalid referralCode");
  }
  const payload = referralCode === undefined ? `c_${publicId}` : `c_${publicId}_${referralCode}`;
  if (payload.length > 64) throw new RangeError("startapp exceeds 64 chars");
  return payload;
}

export function buildCampaignDeepLink(
  botUsername: string,
  appName: string,
  startapp: string,
): string {
  return `https://t.me/${botUsername}/${appName}?startapp=${encodeURIComponent(startapp)}`;
}
