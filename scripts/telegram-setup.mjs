const token = process.env.TELEGRAM_BOT_TOKEN;
const webappUrl = process.env.TELEGRAM_WEBAPP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !webappUrl || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBAPP_URL and TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;

async function call(method, payload) {
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`${method} failed: ${res.status} ${body.description ?? ""}`);
  }
  return body.result;
}

const hookUrl = `${webappUrl.replace(/\/+$/, "")}/api/telegram/webhook`;

await call("setWebhook", { url: hookUrl, secret_token: secret, allowed_updates: ["message"] });
await call("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Open Spark",
    web_app: { url: webappUrl },
  },
});

console.log(`webhook set to ${hookUrl}`);
console.log("menu button set");
