# Deploying Spark to Render + Neon

Single free Render Web Service serves the Telegram Mini App (static), the API, and
the Telegram webhook on one origin — no CORS, relative `/api` requests. Postgres is
hosted on Neon. The bot runs in webhook mode inside the same service.

## 1. Prerequisites

- GitHub repo pushed (private is fine): `leononyango254-source/spark`.
- A [Render](https://render.com) account and a [Neon](https://neon.tech) account (both free).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).

## 2. Neon Postgres

1. Create a Neon project (Postgres 16+).
2. Copy **two** connection strings:
   - **Pooled** (has `-pooler` in the host) → `DATABASE_URL` (app runtime).
   - **Direct** (no `-pooler`) → `DATABASE_DIRECT_URL` (migrations).
3. Both must end with `?sslmode=require`.

## 3. Telegram bot

1. Create the bot with BotFather and copy the token → `TELEGRAM_BOT_TOKEN`.
2. Generate a webhook secret:
   ```bash
   openssl rand -hex 32
   ```
   → `TELEGRAM_WEBHOOK_SECRET`.

## 4. Render service

1. **New → Blueprint**, connect the repo, and apply `render.yaml`.
2. Fill in the `sync: false` secrets: `DATABASE_URL`, `DATABASE_DIRECT_URL`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_WEBAPP_URL`.
   - Use the public URL Render assigns (`https://spark-api.onrender.com` or your
     custom domain) for `TELEGRAM_WEBAPP_URL`.
3. Deploy. The build runs `pnpm install --frozen-lockfile && pnpm build`
   (esbuild API/bot bundles + Vite Mini App). Start runs `scripts/start-api.sh`
   (migrations via `DATABASE_DIRECT_URL`, then `node apps/api/dist/index.js`).

## 5. Register the webhook and menu button

From a machine with the repo checked out:

```bash
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_WEBAPP_URL=https://spark-api.onrender.com \
TELEGRAM_WEBHOOK_SECRET=... \
  node scripts/telegram-setup.mjs
```

Expected: `webhook set to https://.../api/telegram/webhook` and `menu button set`.
The script is idempotent — re-running just re-asserts both.

## 6. Acceptance checklist

```bash
BASE=https://spark-api.onrender.com
curl -s $BASE/health                                   # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/        # 200 (Mini App)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/me  # 401
curl -s -X POST $BASE/api/telegram/webhook -H 'content-type: application/json' -d '{}'   # 401 (no secret)
curl -s -X POST $BASE/api/telegram/webhook \
  -H "x-telegram-bot-api-secret-token: $TELEGRAM_WEBHOOK_SECRET" \
  -H 'content-type: application/json' -d '{"message":{"chat":{"id":1},"text":"/start"}}'  # 200
```

Also open the bot in Telegram and launch the Mini App from the menu button.

## 7. Backup and restore

```bash
pg_dump "$DATABASE_DIRECT_URL" > backup.sql
psql "$DATABASE_DIRECT_URL" < backup.sql
```

## 8. Troubleshooting

- **Cold start:** the free plan sleeps after ~15 min idle; the first request can take
  ~30–60s. Render's health check will keep it warm during traffic.
- **Neon auto-suspend:** the database also suspends when idle; the first query after
  wake may add a small delay.
- **Migrations:** `scripts/start-api.sh` runs them on every boot (idempotent, single
  instance). Alternatively use Render's `preDeployCommand` if your plan supports it.
- **Webhook:** inspect with
  `curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"`.
- **Bundle errors:** run `pnpm build:js` locally and boot the bundle before deploying.

## 9. Mocked / incomplete features

- **Wallet connect** is mocked (no real WalletConnect project id).
- **Settlement / Arc / real USDC** is disabled; the API registers a mock
  `SettlementService` only when `WALLETCONNECT_PROJECT_ID` is set.
- **Membership verification** needs a configured Telegram channel and bot admin rights.
- **Worker** (reward reconciliation) is not deployed on the free plan.
