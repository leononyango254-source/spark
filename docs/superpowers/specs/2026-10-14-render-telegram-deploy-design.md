# Spark Telegram Mini App — Render + Neon Test Deployment (Design)

- **Date:** 2026-10-14
- **Status:** Proposed (awaiting approval)
- **Scope:** Public, no-card test deployment of the existing Telegram Mini App, Fastify API, Telegram bot, and PostgreSQL.
- **Non-goals:** Wallet custody, real payouts, real campaign funding, unfinished settlement logic. No application architecture rewrite.

## 1. Goal & constraints

Deploy the existing app to the internet so a real Telegram user can open the Mini App, authenticate via
server-side `initData` validation, and have the bot respond — at ~$0 and without entering a card.

Hosting decision: **Render** (app + API) and **Neon** (Postgres). Oracle/AWS/GCP are ruled out (card required).

### Verified repository constraints (drive the design)

| Finding | Evidence |
|---|---|
| No production run/build path exists | `node apps/api/src/index.ts` → `ERR_MODULE_NOT_FOUND` (`packages/campaign/src/engine`); `tsx` → `viem` not linked. All imports are extensionless ESM; workspace packages export raw `.ts`. Only Vitest runs today. |
| API routes are already `/api`-prefixed | Path literals like `/api/auth/telegram`; root `GET /health`. No Fastify `prefix`. |
| Frontend origin handling is mixed | `api.ts` uses absolute `VITE_API_ORIGIN`; `main.ts` throws if unset; `settlement.ts` uses relative `/api`. |
| No CORS, no static serving | `apps/api/src` has neither `@fastify/cors` nor `@fastify/static`. |
| Bot client has no webhook support | `TelegramBotClient` only exposes `getMe/getUpdates/sendMessage/getChatAdministrators/getChatMember`. |
| No GitHub remote | `git remote -v` empty. `gh` authed as `leononyango254-source`. |
| Dirty tree / stale lockfile | Uncommitted Phase 6–8 work; `pnpm-lock.yaml` modified; `viem` present in store but unlinked. |
| `.gitignore` blocks env examples | `**/.env.*` ignores `.env.prod.example`; only `.env.example` whitelisted. |
| Migrations need dev deps | `drizzle-kit` is a `@spark/db` devDependency; reads `DATABASE_URL`. |

### Render free-tier constraints (drive the topology)

- Free **Web Services sleep after ~15 min idle** → cold start ~30–60s.
- Free accounts get **750 instance-hours/month** (~730h/mo) → **one** always-on service fits; two do not.
- **No free background worker / cron** → long-polling bot is not viable; **webhook required**.
- Render's free **Postgres expires after 30 days** → use **Neon** (no card, persistent).
- Telegram webhooks require **HTTPS** → Render provides `*.onrender.com` TLS automatically.

## 2. Locked decisions

1. **Topology — Option A:** a single Render Web Service serves the compiled Mini App, the API, and the Telegram webhook. Single origin ⇒ no CORS, relative `/api` works.
2. **Database:** Neon free Postgres (pooled URL for the app, direct URL for migrations).
3. **Bot:** webhook mode, integrated into the API (no polling worker).
4. **Registration:** a manual, idempotent `telegram-setup` script sets the webhook + menu button (no startup coupling).
5. **Source:** deploy from GitHub via Render's native build (`render.yaml`). No Dockerfile is added in this pass; the same build/start commands map cleanly to a Dockerfile if we later move to a permanent VPS.

## 3. Architecture

```
Telegram (user taps menu button / sends /start)
        │  HTTPS
        ▼
Render Web Service  https://<service>.onrender.com
   ├─ /                      → Mini App static (built by Vite, served by Fastify static)
   ├─ /api/*                 → Fastify routes (existing, prefix preserved)
   ├─ /api/telegram/webhook  → Telegram updates (secret-token verified) → handleMessage()
   └─ /health                → health check (used by uptime pinger)
        │
        ▼  DATABASE_URL (sslmode=require, pooled)
   Neon Postgres  (auto-suspend; persistent)

Manual (dev machine): scripts/telegram-setup.ts → setWebhook + setChatMenuButton
```

## 4. Components

### 4.1 Build (reproducible, compiled JS)
- Add an **esbuild** build that bundles `apps/api` → `dist/api/index.js` and (for completeness) `apps/bot` → `dist/bot/index.js` (ESM, `platform=node`, `target=node22`; node builtins + optional natives like `pg-native`, `bufferutil`, `utf-8-validate` marked external).
- Vite already builds the Mini App to `apps/telegram-mini-app/dist`.
- Root `pnpm build` orchestrates: `build:api`, `build:bot`, `build:mini`.
- Production runs **compiled JS** (`node dist/api/index.js`). No `tsx`.

### 4.2 API service (Render Web Service)
- Serve Mini App static files at `/` with SPA fallback via `@fastify/static`.
- Keep existing routes (`/api/*`). Add `POST /api/telegram/webhook`.
- Optionally serve from `apps/telegram-mini-app/dist` copied into the deploy (or a build output the API points to via env `WEB_DIST_DIR`).
- Native Render build:
  - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
  - Start: `node apps/api/dist/api/index.js`
  - Pre-Deploy: `pnpm --filter @spark/db db:migrate` (uses the **direct** Neon URL)

### 4.3 Frontend
- `main.ts`: `const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "";` (remove the throw).
- `env.d.ts`: `VITE_API_ORIGIN?: string`.
- Result: relative `/api/...` requests; `buildApiUrl("", path)` → `/api/...`.
- No secrets in the frontend build.

### 4.4 Bot (webhook)
- Add to `packages/telegram/src/botClient.ts`:
  - `setWebhook({ url, secretToken })`, `deleteWebhook()`, `setChatMenuButton({ webAppUrl })` on `TelegramBotApi` + `TelegramBotClient`.
  - Sanitize errors so the token-bearing request URL is never surfaced/logged.
- New route `POST /api/telegram/webhook`:
  - Reject unless `X-Telegram-Bot-Api-Secret-Token` matches `TELEGRAM_WEBHOOK_SECRET`.
  - Parse the raw update, call `handleMessage(client, messageEnv, update)`, respond `200` promptly.
- `scripts/telegram-setup.ts` (run manually against env): `setWebhook(url=https://<host>/api/telegram/webhook, secret_token=<secret>)` then `setChatMenuButton(web_app=<TELEGRAM_WEBAPP_URL>)`. Idempotent.

### 4.5 Migrations
- One-shot via Render **Pre-Deploy Command** (runs once per deploy, before traffic). API never migrates.
- Uses the Neon **direct** connection (DDL). Fallback if pre-deploy is unavailable: start script runs `db:migrate` once then boots the server (single instance → safe).
- Confirm restart behavior: restarting the service does not re-run pre-deploy; a new deploy does. Failure of migration blocks the deploy.

### 4.6 Security
- Postgres reachable only over the Render↔Neon TLS connection; no public DB port.
- Render exposes only HTTPS (443) publicly.
- Secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DATABASE_URL*`, `WALLETCONNECT_*`) set as Render env vars (`sync: false` in blueprint); never committed.
- `.env.prod.example` (placeholders only) committed; `.gitignore` updated to allow it.
- Bot/API logs must never print the token or webhook secret; fetch errors sanitized.
- Wallet/settlement secrets not required (features out of scope).

### 4.7 Persistence & recovery
- Data lives in Neon (persistent across Render restarts/deploys; auto-suspend on idle, ~0.5s cold query).
- Backups: Neon point-in-time restore (free tier window) + documented `pg_dump` export:
  - `pg_dump "$DATABASE_DIRECT_URL" > backup.sql`
  - `psql "$DATABASE_DIRECT_URL" < backup.sql`
- What survives: Render container recreation, redeploys, restarts, sleep cycles. What is lost: only if the Neon project/DB is deleted.
- `docs/deploy-render.md` documents backup/restore and a tested restore.

## 5. Files to add/change

**New**
- `render.yaml` — Blueprint: one web service, build/start/pre-deploy commands, env vars (`sync: false` for secrets).
- `esbuild.config.mjs` — bundle api (+ bot).
- `scripts/telegram-setup.ts` — idempotent webhook + menu button registration.
- `docs/deploy-render.md` — provisioning, env, backup/restore, runbook, troubleshooting.
- `.env.prod.example` — placeholders only.
- `.node-version` — pin Node 22 for Render.

**Modified**
- `packages/telegram/src/botClient.ts` — webhook + menu-button methods; error sanitization.
- `apps/api/src/server.ts` — register `@fastify/static` (Mini App) + `POST /api/telegram/webhook`.
- `apps/api/src/index.ts` — pass webhook deps/config; serve static dir.
- `apps/api/src/env.ts` — add `TELEGRAM_WEBHOOK_SECRET`, `WEB_DIST_DIR` (optional).
- `apps/telegram-mini-app/src/main.ts` — relative origin default.
- `apps/telegram-mini-app/src/env.d.ts` — optional `VITE_API_ORIGIN`.
- `apps/api/package.json`, `apps/bot/package.json`, root `package.json` — build scripts + `esbuild` devDep; add `@fastify/static`.
- `.gitignore` — add `!**/.env.prod.example`.

**Prerequisite (not feature code)**
- Reconcile `pnpm-lock.yaml` + run a clean `pnpm install` (so `viem` links); commit the Phase 6–8 working tree; create the GitHub remote and push.

## 6. Mocked / incomplete (documented, not fixed)
- **WalletConnect** — `apps/telegram-mini-app/src/wallet.ts` is a mock; no real WC v2.
- **Settlement** — `apps/api/src/index.ts` settlement object is broken (`abi: []`, `sepolia`, `walletConnectMgr.getSigner`); routes are unregistered unless `WALLETCONNECT_*` are set.
- **Membership verification** — requires a real channel + bot admin.
- **Worker** — `worker/` (settlement/reconciliation) is **not deployed**.
- **Arc / real USDC** — disabled.

## 7. Risks
1. **First-ever server run** — bundling may surface dynamic-require/optional-native issues (WalletConnect, viem). Mitigate with externals + local bundle smoke test.
2. **Cold starts** — first user and webhook deliveries are slow; Telegram retries webhooks (~24h) so messages are delayed, not lost. Optional free uptime pinger on `/health` keeps one service within 750h.
3. **Neon cold queries** — ~0.5s after idle.
4. **Lockfile drift / unlinked `viem`** — must reconcile before `--frozen-lockfile` install.
5. **Dirty branch** — deploy a committed revision only.
6. **Free build minutes** (500/mo) — keep bundle lean.
7. **Token/secret leakage** via logs or fetch error URLs — sanitize.
8. **Render free Postgres temptation** — must use Neon (Render free DB expires).

## 8. Acceptance criteria
- [ ] Render service builds from GitHub and boots `node dist/api/index.js` (compiled JS, no tsx).
- [ ] `curl https://<service>.onrender.com/health` → `{"status":"ok"}`; Mini App loads at `/`.
- [ ] Mini App issues **relative** `/api` requests (no hard-coded origin).
- [ ] `POST /api/telegram/webhook` rejects a missing/incorrect secret; accepts valid updates.
- [ ] Telegram `/start` gets a reply; the menu button opens the Mini App.
- [ ] `POST /api/auth/telegram` with real `initData` returns 200 + session; `GET /api/me` with the token returns 200, without → 401.
- [ ] Migrations run once per deploy (pre-deploy), not per instance; failure blocks deploy.
- [ ] Data persists across service restart/redeploy; documented backup→restore reproduces data.
- [ ] No token/secret appears in logs or frontend assets.
- [ ] Mocked/incomplete features documented; wallet/settlement/worker not deployed.

## 9. Rollout (high level)
1. Reconcile lockfile + commit Phase 6–8 tree; create GitHub repo; push.
2. Create Neon project; capture pooled + direct URLs.
3. Create Render service from `render.yaml`; set env vars.
4. Deploy; run pre-deploy migrations.
5. Run `scripts/telegram-setup.ts` against the Render URL.
6. Execute the acceptance checks (incl. local dry run before Render).
