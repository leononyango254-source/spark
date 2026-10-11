import type { TelegramBotApi, TelegramUpdate } from "@spark/telegram";
import { buildCampaignDeepLink, parseStartapp } from "@spark/telegram";

export interface MessageEnv {
  webappUrl: string;
  appName: string;
  botUsername: string;
}

export async function handleMessage(
  api: TelegramBotApi,
  env: MessageEnv,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  if (!message.chat?.id) return;
  const match = /^\/start(?:\s+(.*))?$/.exec(message.text.trim());
  if (!match) return;
  const payload = match[1];
  const parsed = payload === undefined ? null : parseStartapp(payload);
  const url =
    parsed === null
      ? env.webappUrl
      : buildCampaignDeepLink(env.botUsername, env.appName, payload as string);
  try {
    await api.sendMessage(
      message.chat.id.toString(),
      parsed === null ? "Open Spark:" : "Open your campaign:",
      {
        replyMarkup: { inlineKeyboard: [[{ text: "Open Spark", url }]] },
      },
    );
  } catch (err) {
    console.error("[message] sendMessage failed:", err);
  }
}
