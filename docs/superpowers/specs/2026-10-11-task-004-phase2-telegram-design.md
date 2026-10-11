# TASK-004 — Phase 2 Telegram: Design Spec

Date: 2026-10-11

## Goal

Implement PRD §73 (Phase 2 — Telegram): Mini App, Bot, campaign startapp parsing, and membership verifier. Demonstrate **Telegram → Backend → verified user** using a live Bot API membership check behind the existing session auth.

Non-goals (deferred): participation/referral persistence and attribution, reward records, campaign lifecycle / create API, webhook mode, React, real bot deployment config, TSA/multi-factor enforcement (Phase 8).

## Architecture

Units and direction of dependency (one way, no cycles):

- `@spark/telegram` — grows a `TelegramBotClient` (fetch-based Bot API wrapper), campaign-link builder/startapp parser, and live membership verifier. Holds no state; pure + client.
- `@spark/domain` — adds `generateReferralCode()` (8-char URL-safe, distinct from `generatePublicId`).
- `apps/bot` — new long-polling `getUpdates` daemon. Answers `/start` with the Mini App webapp button and deep-links campaign `startapp` payloads. Owns messaging only. Process reads `TELEGRAM_BOT_TOKEN`.
- `apps/api` — adds `POST /api/campaigns/:publicId/verify` (session auth, server-derived user, in-memory 5-min membership cache). No participation/reward writes.
- `apps/telegram-mini-app` — real Vite + vanilla TS app; reads `startapp`, authenticates with `initData`, renders PRD §43/§66 screens, issues checks.

Nothing Telegram-specific is added to `packages/db` beyond what already exists (tasks/participations/campaigns already model channel membership).

## startapp format (PRD §8.2, opaque per PRD)

```
c_<publicId>_<referralCode>
```

- `publicId`: existing 16-char `generatePublicId()` (`/^[0-9a-z]{16,32}$/`).
- `referralCode`: new 8-char `generateReferralCode()` from `@spark/domain` (same alphabet, never reuses publicId generator).
- Payload ≤ 64 chars (Telegram `startapp` limit).
- Phase 2 parses and carries the referral code but does **not** persist attribution (Phase 3).

`@spark/telegram` exports:

- `parseStartapp(payload): { kind: "campaign", publicId: string, referralCode?: string } | null` — strict; unknown shapes → `null`.
- `buildStartapp(publicId, referralCode?): string`.
- `buildCampaignDeepLink(botUsername, appName, startapp): string` → `https://t.me/<bot>/<app>?startapp=<payload>`.

## TelegramBotClient (`@spark/telegram`)

Thin fetch wrapper over `https://api.telegram.org/bot<token>/…` with typed responses. Methods:

- `getChatMember(chatId: bigint | string, telegramUserId: bigint)` → typed `ChatMember` (status + optional `is_member`).
- `getChatAdministrators(chatId)` → list, used by admin precheck.
- `sendMessage(chatId, text, opts?: { inlineKeyboard } )` → for the bot daemon.

Behavior:

- Non-2xx / API `ok:false` → `TelegramApiError` carrying the Telegram error code + description. Callers map to HTTP status; never crash.
- Membership acceptance reuses existing `isAcceptedMembership()` (creator/administrator/member pass; `restricted` passes only when `is_member === true`; left/kicked rejected) — PRD §16.
- Verifier helper: `verifyChannelMembership(client, chatId, telegramUserId)` → `{ ok: boolean, memberStatus: string | null, reason?: string }`.
- Admin precheck helper (PRD §15): `isBotAdministrator(client, chatId): Promise<boolean>` via `getChatAdministrators`, using the PRD §16 accepted statuses. Exposed + documented manual check; enforced at campaign creation in Phase 3 (no create API this phase).

## API route `POST /api/campaigns/:publicId/verify`

- Auth: `spark_session` cookie or `Bearer` (existing `extractToken`/`resolveSession`). Client-supplied identity never authoritative (PRD §17, §53).
- Flow:
  1. Resolve session → user (401 otherwise).
  2. `findCampaignByPublicId(publicId)` → 404 if absent.
  3. Load the campaign's `TELEGRAM_CHANNEL_MEMBERSHIP` task; chat id from `tasks.config.chat_id`, fallback `campaigns.target_chat_id`; 422 if no task/config.
  4. Membership cache lookup (unless `?force=1`); miss → `getChatMember` → `isAcceptedMembership`.
- Cache: in-memory `Map<"<campaignId>:<telegramUserId>", { verified, memberStatus, expiresAt }>`, TTL default 300s (`MEMBERSHIP_CACHE_TTL_MS`). Injected via `buildServer(deps)` as optional `membershipCache` factory (configurable for tests). Single-process assumption.
- Responses:
  - 200 `{ verified, memberStatus, campaignId, cached }`
  - 401 `{ error: "unauthenticated" }`
  - 404 `{ error: "not_found" }`
  - 409 `{ error: "telegram_error", reason: "<code>" }`
  - 422 `{ error: "invalid_task" }`
  - 503 `{ error: "telegram_not_configured" }` (existing pattern when bot token unset)

No participation or reward writes in this phase.

## Mini App (`apps/telegram-mini-app`)

- Vite + TypeScript + `@telegram-apps/sdk`; plain DOM rendering (no React).
- `server=false`, `cloud=false`.
- Reads `startapp` via SDK `retrieveLaunchParams().startParam`; passes through (held for future attribution).
- Screens (PRD §43/§66): Launch (POST raw `initData` to `/api/auth/telegram`; hold opaque token in memory only), Campaign (Earn / Join channel / Reward / Verify button → `POST .../verify?force=1`), Result (✓ Verified / Try again). Referral/share stubbed.
- Never reads `initDataUnsafe`.
- API origin from `VITE_API_ORIGIN` (build-time), `buildApiUrl` helper.
- Static build output served independent of the API (dev servers separate).

## `apps/bot` (new)

- Long-polling `getUpdates` consumer (offset tracking, timeout 30s via `API_BOT_POLL_TIMEOUT`).
- Handles `/start` (with optional `startapp`): replies with inline webapp button (`web_app` url = `TELEGRAM_WEBAPP_URL` + campaign path) and a joined-channel hint where applicable.
- Deps: `@spark/telegram` `TelegramBotClient` + `@spark/domain` link helpers. Same script conventions as `apps/api` (`dev`, `start`, `typecheck`, `test`).
- No job scheduler; pg-boss untouched.

## Env / wiring

- `apps/api` env additions: `MEMBERSHIP_CACHE_TTL_MS` (default `300000`), `TELEGRAM_WEBAPP_URL` (read for bot deep-link construction; currently unused), `TELEGRAM_APP_NAME` (the `<app>` segment).
- `.env.example` documents the new vars.
- Root scripts: `dev:api`, `dev:bot`, `dev:mini` (each a `pnpm --filter … dev`). No workspace-file changes (`apps/*` glob already covers `apps/bot`).

## Testing

- `@spark/telegram`: `parseStartapp`/`buildStartapp` (valid, garbage, long payload, missing code, 64-char cap), `TelegramBotClient` with mocked fetch (getChatMember creator/administrator/member/restricted `is_member:true`/restricted `is_member:false`/left/kicked; API error), `isBotAdministrator`, `verifyChannelMembership`.
- `@spark/domain`: `generateReferralCode` shape + uniqueness sanity.
- `apps/bot`: poll loop with injected `getUpdates` fixtures (message with `/start`, with startapp, empty) — no network.
- `apps/api`: verify route against harness + fake `TelegramBotClient` injected via deps (verified, kicked, restricted-without-membership, 401, 404, 422, force refresh, cache hit → `cached: true`).
- No live Telegram calls in CI. Manual live round-trip documented (Phase 0 residual risk: bot must be admin in the target chat for `getChatMember`).

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (Testcontainers `postgres:17` for the API suite), `cd contracts && forge test` (3/3) stays green.
- Manual demo checklist: run `apps/bot` + `apps/api` + mini-app; POST a signed `initData` fixture; verify accepted status passes and left/kicked fails.