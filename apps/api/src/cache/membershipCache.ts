interface MembershipCacheEntry {
  verified: boolean;
  memberStatus: string | null;
  expiresAt: number;
}

export interface MembershipCache {
  ttlMs: number;
  get(key: string): MembershipCacheEntry | undefined;
  set(key: string, entry: MembershipCacheEntry): void;
}

export function createMembershipCache(
  ttlMs: number,
  now: () => number = Date.now,
): MembershipCache {
  const entries = new Map<string, MembershipCacheEntry>();
  return {
    ttlMs,
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry;
    },
    set(key, entry) {
      entries.set(key, entry);
    },
  };
}
