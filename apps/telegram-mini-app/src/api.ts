export function buildApiUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: { id: string; telegramUserId: string; username: string | null };
}

export interface VerifyResponse {
  verified: boolean;
  memberStatus: string | null;
  campaignId: string;
  cached: boolean;
}

export async function authenticate(apiOrigin: string, initData: string): Promise<AuthResponse> {
  const res = await fetch(buildApiUrl(apiOrigin, "/api/auth/telegram"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  return res.json();
}

export async function verify(
  apiOrigin: string,
  token: string,
  publicId: string,
  force: boolean,
): Promise<VerifyResponse> {
  const query = force ? "?force=1" : "";
  const res = await fetch(
    buildApiUrl(apiOrigin, `/api/campaigns/${encodeURIComponent(publicId)}/verify${query}`),
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);
  return res.json();
}
