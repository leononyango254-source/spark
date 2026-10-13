# Phase 6: Wallet Onboarding Design

## Scope

Implements PRD §77 (Phase 6 — Wallet): user wallet onboarding via WalletConnect v2 in the Telegram Mini App, with backend API and DB persistence. The operator viem EOA (Phase 5) remains unchanged for payouts.

**In scope**
- Extend `users` table with wallet fields (`wallet_address`, `wallet_provider`, `wallet_status`, `wallet_chain_id`)
- WalletConnect v2 session management in `@spark/wallet` (new `WalletConnectProvider` implementing `WalletProvider`)
- API endpoints: `POST /api/wallet/connect`, `GET /api/wallet/connect/:sessionId`, `POST /api/wallet/disconnect`
- Telegram Mini App React component: QR code modal, connection polling, disconnect button
- On connect: update `users` wallet fields + upsert into `wallet_associations` for active campaigns

**Out of scope (later phases)**
- Circle Developer-Controlled Wallets (DCW) — deferred per S0-3 waiver
- Circle Onramp widget — spike only per S0-7
- Multi-wallet per user — MVP supports one primary wallet
- Mainnet wallet onboarding — Phase 7 Real Demo

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wallet standard | **WalletConnect v2** | Universal mobile wallet support via QR/deep link; works in Telegram Mini App iframe |
| Mini App UI | **Full stack (B1)** | Wallet UX is Phase 6 core; Mini App component integral |
| Data model | **Extend users table (C1)** | Aligns with PRD §7; single primary wallet per user; `wallet_associations` for per-campaign |
| Provider abstraction | **New `WalletConnectProvider`** | Implements existing `WalletProvider` interface; operator viem EOA unchanged |
| Session storage | **Ephemeral in-memory** | WalletConnect session keys never persisted; only session ID tracked |

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Telegram Mini App (React)                                       │
│  └─ WalletConnectButton → QR Modal → Poll /connect/:id          │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTPS
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ API (Fastify)                                                   │
│  POST /wallet/connect      → create WC session, return URI      │
│  GET  /wallet/connect/:id  → poll for approval                  │
│  POST /wallet/disconnect   → kill session, clear user fields    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌───────────────────┐   ┌──────────────────────────────────────┐
│ @spark/wallet     │   │ @spark/db (Postgres)                 │
│ WalletConnectProvider │   │ users: wallet_address,           │
│   - createSession()   │   │ wallet_provider, wallet_status,  │
│   - waitForApproval() │   │ wallet_chain_id                  │
│   - disconnect()      │   │ wallet_associations (per-campaign)│
└───────────────────┘   └──────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WalletConnect Relay (cloud) ↔ User Wallet App (MetaMask, etc.)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### `users` table (new columns)

```sql
ALTER TABLE users ADD COLUMN wallet_address text;
ALTER TABLE users ADD COLUMN wallet_provider text;
ALTER TABLE users ADD COLUMN wallet_status text;
ALTER TABLE users ADD COLUMN wallet_chain_id integer;
```

- `wallet_address` — connected wallet address (checksummed)
- `wallet_provider` — e.g., `'walletconnect'`
- `wallet_status` — `'connected'` | `'disconnected'`
- `wallet_chain_id` — e.g., `5042002` (Arc testnet)

### `wallet_associations` (existing)

Per-campaign wallet mapping. On wallet connect, upsert for all user's active campaigns:
```ts
await upsertWalletAssociation(db, {
  campaignId,
  userId,
  address: user.wallet_address,
  normalizedAddress: user.wallet_address.toLowerCase(),
});
```

---

## Packages & Interfaces

### `@spark/wallet` — new `WalletConnectProvider`

```ts
// packages/wallet/src/walletConnect.ts
import { SignClient, SignClientTypes } from "@walletconnect/sign-client";

export interface WalletConnectConfig {
  projectId: string;           // WalletConnect Cloud project ID
  relayUrl?: string;           // optional custom relay
  metadata: SignClientTypes.Metadata;
}

export interface WalletConnectSession {
  topic: string;
  uri: string;
  peer: SignClientTypes.SessionTypes.Peer;
  namespaces: SignClientTypes.Namespaces;
}

export async function createWalletConnectProvider(config: WalletConnectConfig): Promise<WalletProvider> {
  const client = await SignClient.init({ projectId: config.projectId, relayUrl: config.relayUrl, metadata: config.metadata });
  // ... implementation
}
```

- Adds `@walletconnect/sign-client` v2 as dependency
- Implements `WalletProvider` interface (`address`, `getNonce`, `sendTransaction`, `getReceipt`)
- For user wallet: `sendTransaction`/`getReceipt` delegate to wallet via WC `wc_sessionRequest`
- For operator: existing viem EOA provider unchanged

### `@spark/db` — new repositories

```ts
// packages/db/src/repositories/users.ts (additions)
export async function updateUserWallet(
  db: Db,
  userId: string,
  wallet: { address: string; provider: string; chainId: number },
): Promise<UserRow>;

export async function clearUserWallet(db: Db, userId: string): Promise<UserRow>;
```

### `apps/api` — new routes

```ts
// apps/api/src/routes/wallet.ts
POST   /api/wallet/connect      → { sessionId: string; uri: string }
GET    /api/wallet/connect/:id  → { status: 'pending' | 'connected'; address?: string; chainId?: number }
POST   /api/wallet/disconnect   → { success: true }
```

- All endpoints require authenticated Telegram session (existing `resolveSession`)

### `apps/telegram-mini-app` — new component

```tsx
// apps/telegram-mini-app/src/components/WalletConnect.tsx
export function WalletConnectButton({ onConnect }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // onClick: POST /connect → get uri + sessionId → show QR modal → poll GET /connect/:sessionId
  // onDisconnect: POST /disconnect → clear local state
}
```

- Uses existing Telegram Web App UI components (button, modal, QR code display via `qrcode.react`)
- Polling interval: 2s, timeout 5min

---

## Env & Config

New `.env.example` entries:
```
# WalletConnect (Phase 6)
WALLETCONNECT_PROJECT_ID=your_walletconnect_cloud_project_id
WALLETCONNECT_RELAY_URL=wss://relay.walletconnect.com  # optional
```

Required: WalletConnect Cloud project ID (free tier at cloud.walletconnect.com).

---

## Security

- WalletConnect session keys **never stored** server-side; only ephemeral `sessionId` tracked
- User wallet address comes from WC session approval (cryptographically verified)
- All wallet endpoints guarded by existing Telegram auth (`resolveSession`)
- Operator viem EOA secret (`OPERATOR_PRIVATE_KEY`) **unchanged**, separate from user wallet flow
- `wallet_provider` value validated against allowlist (`'walletconnect'`)

---

## Testing

**Mocked unit tests** (no network):
- `@spark/wallet`: `WalletConnectProvider` with mocked `SignClient` (create session, wait for approval, disconnect)
- `apps/api`: wallet routes with mocked provider (session creation, polling, disconnect)
- `@spark/db`: `updateUserWallet`, `clearUserWallet`, `wallet_associations` upsert on connect

**Manual integration test** (testnet):
- Run Mini App locally, connect real MetaMask via WalletConnect QR
- Verify `users` table updated + `wallet_associations` upserted for active campaign

---

## Definition of Done

- User can click "Connect Wallet" in Mini App → sees QR code → scans with MetaMask → approves → sees connected address
- `users` table shows `wallet_address`, `wallet_provider='walletconnect'`, `wallet_status='connected'`, `wallet_chain_id=5042002`
- `wallet_associations` has rows for all user's active campaigns with the connected address
- Disconnect button clears wallet fields and removes associations
- All unit tests pass; typecheck clean; lint clean

---

## Future Extension Points

- **Circle DCW (testnet)**: add `CircleDcwProvider` implementing `WalletProvider` behind same interface
- **Multi-wallet**: `user_wallets` table + UI to switch primary
- **Mainnet**: same flow with `wallet_chain_id=5042` and mainnet WalletConnect project ID
- **EIP-712 authorization**: user wallet signs `payReward` authorization (deferred per Phase 4)