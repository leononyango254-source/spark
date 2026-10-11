export const ACCEPTED_MEMBER_STATUSES = ["creator", "administrator", "member"] as const;

export interface ChatMember {
  status: string;
  is_member?: boolean;
}

/** creator / administrator / member pass; restricted passes only when is_member === true. */
export function isAcceptedMembership(member: ChatMember): boolean {
  if ((ACCEPTED_MEMBER_STATUSES as readonly string[]).includes(member.status)) return true;
  if (member.status === "restricted") return member.is_member === true;
  return false;
}
