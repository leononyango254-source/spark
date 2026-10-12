# Phase 4: CampaignEscrow Contract Design

## Scope

Implements PRD §75 (Phase 4 — Contract): production-ready `CampaignEscrow` contract replacing the Phase 0 spike. The contract manages campaign escrow funds, enforces budget protection, provides replay protection, and enables operator-driven reward payouts with absolute timestamp expiry.

**Out of scope for Phase 4**: EIP-712 authorization signatures (Phase 5), real Arc settlement (Phase 5), wallet integration (Phase 6).

---

## Contract Interface

```solidity
interface ICampaignEscrow {
    // Owner-only configuration
    function createCampaign(address creator, uint256 budget, uint256 deadline) external returns (uint256 campaignId);
    function setOperator(address operator) external;
    function setGlobalPayoutAllowance(uint256 allowance) external;
    function setMaxPayoutPerReward(uint256 max) external;
    function pause() external;
    function unpause() external;

    // Funding (anyone)
    function fundCampaign(uint256 campaignId, uint256 amount) external;

    // Operator reward payout
    function payReward(
        uint256 campaignId,
        uint256 rewardId,
        uint256 nonce,
        address recipient,
        uint256 amount,
        uint256 deadline
    ) external;

    // Campaign closure
    function closeCampaign(uint256 campaignId) external;

    // Views
    function getCampaign(uint256 id) external view returns (Campaign memory);
    function isRewardProcessed(uint256 rewardId) external view returns (bool);
    function isNonceUsed(uint256 campaignId, uint256 nonce) external view returns (bool);
    function isPaused() external view returns (bool);
}
```

---

## Data Structures

```solidity
struct Campaign {
    address creator;
    uint256 budget;
    uint256 balance;
    uint256 deadline;
    bool closed;
}
```

---

## State Variables

```solidity
IERC20 public immutable usdc;
uint256 public maxPayoutPerReward;
uint256 public globalPayoutAllowance;
address public owner;
address public operator;
bool public paused;

mapping(uint256 => Campaign) public campaigns;
mapping(uint256 => bool) public processedReward;        // rewardId -> bool (global)
mapping(uint256 => mapping(uint256 => bool)) usedNonce; // campaignId -> nonce -> bool
uint256 public nextCampaignId;
bool public paused;
```

---

## Function Specifications

### createCampaign (Owner)
```solidity
function createCampaign(address creator, uint256 budget, uint256 deadline) external returns (uint256)
```
- **Access**: `onlyOwner`
- **Requires**: `budget > 0`, `deadline > block.timestamp`
- **Effects**: Creates campaign with `id = nextCampaignId++`, balance = 0, closed = false
- **Emits**: `CampaignCreated(id, creator, budget, deadline)`

### setOperator (Owner)
```solidity
function setOperator(address newOperator) external
```
- **Access**: `onlyOwner`
- **Emits**: `OperatorSet(newOperator)`

### setGlobalPayoutAllowance (Owner)
```solidity
function setGlobalPayoutAllowance(uint256 allowance) external
```
- **Access**: `onlyOwner`
- **Emits**: `GlobalAllowanceUpdated(allowance)`

### setMaxPayoutPerReward (Owner)
```solidity
function setMaxPayoutPerReward(uint256 max) external
```
- **Access**: `onlyOwner`
- **Emits**: `MaxPayoutUpdated(max)`

### pause (Owner)
```solidity
function pause() external
```
- **Access**: `onlyOwner`
- **Effects**: `paused = true`
- **Emits**: `CampaignPaused()`

### unpause (Owner)
```solidity
function unpause() external
```
- **Access**: `onlyOwner`
- **Effects**: `paused = false`
- **Emits**: `CampaignUnpaused()`

### fundCampaign (Anyone)
```solidity
function fundCampaign(uint256 campaignId, uint256 amount) external
```
- **Access**: Public (any caller)
- **Requires**: `!paused`, `!campaign.closed`, `amount > 0`, `IERC20(usdc).transferFrom(msg.sender, address(this), amount)`
- **Effects**: `campaign.balance += amount`
- **Emits**: `CampaignFunded(campaignId, amount)`

### payReward (Operator)
```solidity
function payReward(
    uint256 campaignId,
    uint256 rewardId,
    uint256 nonce,
    address recipient,
    uint256 amount,
    uint256 deadline
) external
```
- **Access**: `onlyOperator`
- **Requires**:
  - `!paused`
  - `!campaign.closed`
  - `block.timestamp <= deadline`
  - `recipient != address(0)`
  - `!processedReward[rewardId]`
  - `!usedNonce[campaignId][nonce]`
  - `amount <= campaign.balance`
  - `amount <= maxPayoutPerReward`
  - `amount <= globalPayoutAllowance`
- **Effects** (atomic):
  - `processedReward[rewardId] = true`
  - `usedNonce[campaignId][nonce] = true`
  - `campaign.balance -= amount`
  - `globalPayoutAllowance -= amount`
  - `IERC20(usdc).transfer(recipient, amount)`
- **Emits**: `RewardPaid(campaignId, rewardId, recipient, amount, nonce)`

### closeCampaign (Owner or Creator)
```solidity
function closeCampaign(uint256 campaignId) external
```
- **Access**: `msg.sender == owner || msg.sender == campaign.creator`
- **Requires**: `!campaign.closed`
- **Effects**:
  - `refund = campaign.balance`
  - `campaign.balance = 0`
  - `campaign.closed = true`
  - `IERC20(usdc).transfer(campaign.creator, refund)` (if refund > 0)
- **Emits**: `CampaignClosed(campaignId, closer, refund)`

---

## Replay Protection

| Mechanism | Scope | Purpose |
|-----------|-------|---------|
| `processedReward[rewardId]` | Global | Primary business-level idempotency - prevents any reward from being paid twice |
| `usedNonce[campaignId][nonce]` | Per-campaign | Additional authorization-level guard against nonce reuse |

**Properties**:
- `rewardId` is **globally unique** across all campaigns
- Nonces are **per-campaign** and may be consumed **out-of-order** (no `nextNonce` enforcement)
- Backend allocates nonces atomically with unique DB constraint on `(campaign_id, nonce)`

---

## Expiry

```solidity
require(block.timestamp <= deadline, "Expired");
```
- Absolute timestamp (Unix seconds)
- Enforced on every `payReward` call

---

## Budget Protection

| Check | Description |
|-------|-------------|
| `amount <= campaign.balance` | Campaign cannot pay more than funded balance |
| `amount <= maxPayoutPerReward` | Single reward payout cap |
| `amount <= globalPayoutAllowance` | Global operator payout cap |

---

## Access Control

| Operation | Allowed Callers |
|-----------|-----------------|
| `createCampaign` | Owner only |
| `setOperator`, `setGlobalPayoutAllowance`, `setMaxPayoutPerReward`, `pause`, `unpause` | Owner only |
| `fundCampaign` | Anyone |
| `payReward` | Operator only |
| `closeCampaign` | Owner or Campaign Creator |

---

## Emergency Controls

- **Pausable**: `pause()` / `unpause()` (Owner only)
- **Pause scope**: Blocks `createCampaign`, `fundCampaign`, `payReward`
- **Not paused**: `closeCampaign` (allows recovery of funds)
- **No arbitrary withdrawal**: Pausing only blocks new operations; no emergency withdrawal function

---

## Events (Full Set)

```solidity
event CampaignCreated(uint256 indexed id, address indexed creator, uint256 budget, uint256 deadline);
event CampaignFunded(uint256 indexed campaignId, uint256 amount);
event RewardPaid(uint256 indexed campaignId, uint256 indexed rewardId, address indexed to, uint256 amount, uint256 nonce);
event CampaignClosed(uint256 indexed campaignId, address indexed closer, uint256 refunded);
event CampaignPaused();
event CampaignUnpaused();
event OperatorSet(address indexed newOperator);
event GlobalAllowanceUpdated(uint256 newAllowance);
event MaxPayoutUpdated(uint256 newMax);
```

---

## Error Types

```solidity
error NotOwner();
error NotOperator();
error Paused();
error CampaignIsClosed();
error PayoutTooLarge();
error InsufficientBalance();
error AllowanceExceeded();
error RewardAlreadyPaid();
error NonceAlreadyUsed();
error Expired();
error InvalidRecipient();
error InvalidAmount();
error TokenTransferFailed();
error NotAuthorized();
```

---

## Constructor

```solidity
constructor(
    address _usdc,
    uint256 _maxPayoutPerReward,
    uint256 _globalPayoutAllowance
) {
    owner = msg.sender;
    operator = msg.sender;
    usdc = _usdc;
    maxPayoutPerReward = _maxPayoutPerReward;
    globalPayoutAllowance = _globalPayoutAllowance;
}
```

---

## Security Considerations

1. **Reentrancy**: All state-changing functions use `ReentrancyGuard`
2. **Expiry enforced on-chain**: `block.timestamp <= deadline`
3. **Replay protection**: Dual-layer (rewardId + nonce)
4. **Budget protection**: Three-layer cap (campaign balance, per-reward max, global allowance)
5. **Access control**: Role-based (owner/operator/creator)
5. **Pause without withdrawal**: Pause blocks new operations only; no arbitrary withdrawal
6. **No EIP-712 in MVP**: Operator-only payout; EIP-712 deferred to Phase 5
7. **Nonce out-of-order**: Allows concurrent payouts without sequencing bottleneck
8. **Globally unique rewardId**: Primary idempotency key; mapped 1:1 with business reward

---

## Future Extension Point (Phase 5)

The `payReward` interface is designed to accept an `authorization` parameter later:

```solidity
// Phase 5 extension (not in MVP)
function payReward(
    uint256 campaignId,
    uint256 rewardId,
    uint256 nonce,
    address recipient,
    uint256 amount,
    uint256 deadline,
    bytes calldata authorization  // EIP-712 signature
) external;
```

The MVP omits this parameter entirely. Adding it later is a signature change with contract verification - no dormant parameter to confuse implementers.

---

## Testing Requirements

### Unit Tests (Forge)
- `createCampaign` / `fundCampaign` / `payReward` / `closeCampaign` happy path
- Access control: `onlyOwner`, `onlyOperator`, creator-close
- Pause: blocks create/fund/pay, allows close
- Budget caps: per-reward, campaign balance, global allowance
- Replay protection: duplicate rewardId, duplicate nonce
- Expiry: deadline in past reverts
- Access control: non-owner create, non-operator pay, non-creator/owner close
- Nonce out-of-order: nonce 20 before 19 succeeds
- Close: refund to creator, closed state blocks further ops

### Fuzz Tests
- `payReward` with random amounts/nonce combinations
- Concurrent `fundCampaign` + `payReward`
- Exhausting campaign balance / global allowance

### Invariant Tests
- `sum(reward amounts) <= sum(campaign balances)`
- `processedReward` values are unique
- `usedNonce` values are unique per campaign

---

## Deployment

- **Network**: Base Sepolia (testnet) → Base Mainnet
- **USDC**: Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e) / Mainnet USDC
- **Constructor args**: `usdc`, `maxPayoutPerReward` (e.g., 10_000_000 = 10 USDC), `globalPayoutAllowance` (e.g., 1_000_000_000 = 1000 USDC)
- **Owner**: Deployer (multisig recommended for mainnet)
- **Verification**: `forge verify-contract` on BaseScan

---

## Backend Integration Notes

### Nonce Allocation (Backend)
```sql
-- Atomic allocation within DB transaction
BEGIN;
SELECT next_nonce FROM campaign_nonces WHERE campaign_id = $1 FOR UPDATE;
UPDATE campaign_nonces SET next_nonce = next_nonce + 1 WHERE campaign_id = $1;
INSERT INTO rewards (campaign_id, nonce, ...) VALUES ($campaignId, $nextNonce, ...);
COMMIT;
```
- Unique constraint on `(campaign_id, nonce)`
- Atomic allocation prevents duplicate nonces under concurrency

### Reward ID
- Globally unique (e.g., `bigserial` or UUID)
- Used as primary idempotency key in contract

---

## Migration from Spike

The Phase 0 spike contract (`contracts/src/CampaignEscrow.sol`) will be **replaced entirely** with this production implementation. The test file `CampaignEscrow.t.sol` will be extended with the new test cases.

---

## Out of Scope (Future Phases)

| Feature | Phase |
|---------|-------|
| EIP-712 authorization signatures | Phase 5 |
| Real Arc operator settlement | Phase 5 |
| Reconciliation service | Phase 5 |
| Wallet provider integration | Phase 6 |
| Mainnet deployment | Phase 7 |
| Polished UI / dashboard | Phase 8 |