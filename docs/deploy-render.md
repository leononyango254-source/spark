# Deploying Spark to Render + Neon

Single free Render Web Service serves the Telegram Mini App (static), the API, and
the Telegram webhook on one origin — no CORS, relative `/api` requests. Postgres is
hosted on Neon. The bot runs in webhook mode inside the same service.

## 1. Prerequisites

- GitHub repo pushed (private is fine): `leononyango254-source/spark`.
- A [Render](https://render.com) account and a [Neon](https://neon.tech) account (both free).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).

## 2. Neon Postgres

This repo is already linked to a Neon project (`dark-frog-20086793`, branch
`production`) via `.neon`, using the `agent` CLI profile. To recreate from scratch:

```bash
npm i -g neon@latest
neon link --org-id <org-id> --project-id <project-id> --branch production
```

`neon link` writes two connection strings into `.env` (both `sslmode=require`):

- **`DATABASE_URL`** — pooled (host contains `-pooler`); the app's runtime traffic.
- `DATABASE_URL_UNPOOLED` — direct; used only for migrations/dumps.

Then apply the schema to the linked branch with the direct URL:

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @spark/db db:migrate
```

## 3. Telegram bot

1. Create the bot with BotFather and copy the token → `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_BOT_USERNAME` to the bot's `@username` without the `@`
   (this bot: `sparkjs_bot`). Referral deep links use
   `t.me/<TELEGRAM_BOT_USERNAME>/<TELEGRAM_APP_NAME>?startapp=…`.
3. Generate a webhook secret:
   ```bash
   openssl rand -hex 32
   ```
   → `TELEGRAM_WEBHOOK_SECRET`.

## 4. Render service

1. **New → Blueprint**, connect the repo, and apply `render.yaml`.
2. Fill in the `sync: false` secrets: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_WEBAPP_URL`.
   - Use the public URL Render assigns (`https://spark-api.onrender.com` or your
     custom domain) for `TELEGRAM_WEBAPP_URL`.
3. Deploy. The build runs `pnpm install --frozen-lockfile && pnpm build`
   (esbuild API/bot bundles + Vite Mini App). Start runs `scripts/start-api.sh`
   (migrations via `DATABASE_URL_UNPOOLED`, then `node apps/api/dist/index.js`).

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
pg_dump "$DATABASE_URL_UNPOOLED" > backup.sql
psql "$DATABASE_URL_UNPOOLED" < backup.sql
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
- **Worker** (reward reconciliation) is not deployed as a separate service on the free
  plan; instead the API runs the settlement cycle in-process when `SETTLEMENT_ENABLED=true`
  (see §10).

## 10. On-chain settlement (operator EOA)

The API runs the settlement + reconciliation cycle in-process when `SETTLEMENT_ENABLED=true`
(no separate Render worker). On boot it reconciles, then settles on an interval. A manual
trigger is exposed at `POST /api/admin/settle` (guarded by `x-admin-token`).

Prerequisites:

- Operator `0xfB4d…` funded with test USDC at `0x3600…0000` on Arc testnet.
- A campaign with `on_chain_campaign_id` set (via the seed script) and a
  `wallet_association` for the payout recipient.

Set on the Render service `srv-db7a4gu01pc73duj120`: `SETTLEMENT_ENABLED=true`,
`ADMIN_TOKEN`, `ARC_RPC_URL`, `ARC_CHAIN_ID`, `ARC_USDC_ADDRESS`, `ESCROW_ADDRESS`,
`OPERATOR_PRIVATE_KEY` (secret), `SETTLE_INTERVAL_SECONDS`, `RECONCILE_INTERVAL_SECONDS`.

Seed and associate (run locally against the prod `DATABASE_URL`):

```
pnpm --filter @spark/worker seed:campaign <campaign-uuid> 1000000
pnpm --filter @spark/worker associate:wallet <campaign-uuid> <telegram-user-id> 0x<recipient>
```

Trigger and verify:

```
curl -X POST https://spark-api-ksgo.onrender.com/api/admin/settle -H "x-admin-token: $ADMIN_TOKEN"
```

Expect a reward to move `AUTHORIZED → SUBMITTED → CONFIRMED → PAID` and a `RewardPaid`
log on Arc testnet. A second identical call while a cycle is running is a no-op.
