# S0-6 — Telegram `initData` Validation + Membership

**Result:** ✅ GO (validator) / 🟡 live membership check pending bot token

## Evidence

### HMAC validation (✅)
Implemented and unit-tested in `spikes/s06-telegram/validate.ts`:
- `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`
- `data_check_string` = sorted `k=v` pairs joined by `\n`, excluding `hash`
- `expected = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))`
- `timingSafeEqual(expected, provided_hash)` (constant-time)
- Freshness: reject if `now - auth_date > 300s`; reject if `auth_date > now + 60s` (future).

`node --test` → **9 passed, 0 failed**:
- accepts valid initData (identity `user.id` extracted)
- rejects tampered field (`bad_hash`)
- rejects wrong bot token (`bad_hash`)
- rejects stale `auth_date` (`expired`)
- accepts exactly 300s boundary
- rejects missing hash
- membership state machine: `creator`/`administrator`/`member` accepted
- `restricted` accepted only when `is_member === true`
- `left`/`kicked` rejected

### Membership via Bot API (🟡 blocked)
`getChatMember` acceptance rules are encoded (`isAcceptedMembership`), but the live API call requires:
1. A real bot token (no token set in env).
2. The bot configured as an **administrator** of the target chat.
3. A test user in the chat.

## Conclusion
The deterministic webhook/Mini App auth logic is verified. Only the live `getChatMember` round-trip and the bot-admin deployment requirement remain to be validated at integration time (not a code risk).

## Repro
```bash
cd spikes/s06-telegram && node --test
```
