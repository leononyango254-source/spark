import type { TelegramBotApi } from "./botClient";
import { TelegramApiError } from "./botClient";
import { type ChatMember, isAcceptedMembership } from "./membership";

export type MembershipVerification =
  | { ok: true; memberStatus: string }
  | { ok: false; memberStatus: string | null; reason: string };

export async function verifyChannelMembership(
  api: TelegramBotApi,
  chatId: bigint | string,
  telegramUserId: bigint,
): Promise<MembershipVerification> {
  let member: ChatMember;
  try {
    member = await api.getChatMember(chatId, telegramUserId);
  } catch (error) {
    if (error instanceof TelegramApiError) {
      return { ok: false, memberStatus: null, reason: `telegram_${error.code}` };
    }
    throw error;
  }
  if (!isAcceptedMembership(member)) {
    return { ok: false, memberStatus: member.status, reason: "not_member" };
  }
  return { ok: true, memberStatus: member.status };
}

export async function isBotAdministrator(
  api: TelegramBotApi,
  chatId: bigint | string,
): Promise<boolean> {
  const me = await api.getMe();
  const admins = await api.getChatAdministrators(chatId);
  return admins.some((admin) => admin.user?.id === me.id);
}
