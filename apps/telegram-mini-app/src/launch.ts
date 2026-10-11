export function parseStartParam(
  payload: string,
): { publicId: string; referralCode?: string } | null {
  if (payload.length > 64) return null;
  const match = /^c_([0-9a-z]{16,32})(?:_([0-9a-z]{8}))?$/.exec(payload);
  if (!match) return null;
  const publicId = match[1];
  if (!publicId) return null;
  const result: { publicId: string; referralCode?: string } = { publicId };
  if (match[2]) result.referralCode = match[2];
  return result;
}
