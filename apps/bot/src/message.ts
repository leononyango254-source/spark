import type { TelegramBotApi, TelegramUpdate } from "@spark/telegram";
import { buildCampaignDeepLink, parseStartapp } from "@spark/telegram";

export interface MessageEnv {
  webappUrl: string;
  appName: string;
  botUsername: string;
  apiOrigin: string;
  apiToken: string;
}

export async function handleMessage(
  api: TelegramBotApi,
  env: MessageEnv,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  if (!message.chat?.id) return;
  const shareMatch = /^\/share\s+(.+)$/.exec(message.text.trim());
  if (shareMatch && env.apiOrigin && env.apiToken) {
    const payload = shareMatch?.[1] as string;
    const [publicId, code] = payload.split("_") as [string, string];
    const referralResponse = await fetch(
      `${env.apiOrigin}/api/campaigns/${publicId}/referral-link`,
      {
        headers: { authorization: `Bearer ${env.apiToken}` },
      },
    );
    const referralLink = (await referralResponse.json()) as { deepLink: string };
    try {
      await api.sendMessage(message.chat.id.toString(), `Share c_${publicId}_${code}:`, {
        replyMarkup: {
          inlineKeyboard: [[{ text: "Share", url: referralLink.deepLink }]],
        },
      });
    } catch (err) {
      console.error("[message] sendMessage failed:", err);
    }
    return;
  }
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
