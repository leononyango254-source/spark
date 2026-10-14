docs(plan): Phase 7 real demo implementation plan

## Objective
Integrate wallet-connected frontend with Arc settlement contract to demonstrate a real user flow: user connects wallet → funds are managed → payouts processed via the on-chain contract.

## Design Choices (User Confirmed)
- **Phase 7 = Real Demo** — integrate wallet onboarding (Phase 6) with Arc settlement (Phase 5) to show end-to-end flow
- **User onboarding already complete** from Phase 6 — users can connect via WalletConnect v2 in Telegram Mini App
- **Contract already on main** at `0x9539efAFf246799827E6F5E6Cbc475122710Ef64` on Arc testnet (Phase 5 merge `e51cf7b`)
- **No new token or coin** — using existing Arc testnet native token
- **Demo flow**: User connects wallet → funds appear in UI → user triggers payout → contract processes settlement → status shown in Mini App

## Implementation Plan

### Phase 7 Tasks (7 tasks, estimated)

**Task 1: Settlement helper service** (`@spark/settlement` or `packages/settlement`)
- Create `packages/settlement/src/index.ts` with functions:
  - `getUserBalance(userAddress, chainId)` — query contract balance
  - `submitSettlement(userAddress, amount, chainId)` — send settlement tx
  - `getSettlementStatus(txHash)` — poll for receipt
- Export from existing package or new lightweight package

**Task 2: API — settlement endpoints** (`apps/api/src/routes/settlement.ts`)
- `POST /api/settlement/submit` — accept `{ address, amount, chainId }`, call settlement helper, return txHash
- `GET /api/settlement/status/:txHash` — poll status, return settled/pending
- Wire into `server.ts` deps (needs `Db` for user lookup + `WalletConnectSessionManager`)

**Task 3: Mini App — settlement UI** (`apps/telegram-mini-app/src/settlement.ts`)
- New `SettlementClient` class with `submit()`, `pollStatus()`
- Integrate into `main.ts` after wallet section:
  - Show user's connected address
  - Input field for payout amount
  - "Submit Payout" button → opens wallet connect modal or uses already-connected wallet
  - Status display polling `/api/settlement/status/:txHash`
  - "Refresh" button

**Task 4: Typechain/ABI integration** — optional
- If the Arc settlement contract has a decoded ABI, generate Typechain types
- Or use raw `viem` contract calls with the known contract address
- Minimal: just use `viem` `parseAbiIfNeeded` or `multicall` pattern

**Task 5: End-to-end test** — integration test flow
- Start Postgres + app
- User "connects wallet" (Phase 6 flow)
- Submits a settlement → gets txHash
- Polls status → shows "settled"
- Test uses real contract on Arc testnet (or local fork if available)

**Task 6: Env + config updates**
- Add `ARC_CONTRACT_ADDRESS` to `.env.example` + `apps/api/src/env.ts`
- Ensure `WALLETCONNECT_PROJECT_ID` is set for wallet connect
- Any chain-specific RPC URLs if needed

**Task 7: Final verification**
- Full typecheck across all packages
- All test suites pass (DB + Wallet + API + Mini App + new Settlement)
- Demo script: "connect wallet → submit payout → see status update"

## Acceptance Criteria
- User can connect wallet via WalletConnect v2 (already done in Phase 6)
- User can submit a settlement transaction via the API + contract
- UI shows transaction status (pending → settled)
- All existing tests continue to pass
- Typecheck clean across all packages

## Dependencies on Prior Phases
- **Phase 5**: Arc Settlement contract `0x9539efAFf246799827E6F5E6Cbc475122710Ef64` on Arc testnet ✅ (merged `main`)
- **Phase 6**: WalletConnect v2 user onboarding ✅ (this branch `task-008-phase6-wallet`)
- **Phase 4**: Contract ABI/escrow (already merged, contract at known address)

## Success Metrics
- 7/7 tasks complete
- Typecheck: clean across all packages
- Test suite: all existing tests pass + new integration test passes
- Demo flow: connect wallet → submit → status update works end-to-end

---
*Roadmap: Phase 5 → Phase 6 → Phase 7 (Real Demo) → Phase 8 (Bounty Polish)*