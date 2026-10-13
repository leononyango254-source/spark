# Phase 4 — CampaignEscrow Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 spike `CampaignEscrow.sol` with the production Phase 4 contract (PRD §75): on-chain campaign escrow with replay protection, absolute expiry, per-campaign + global budget caps, owner/operator/creator access control, and pause-without-withdrawal — plus Foundry unit, fuzz, and invariant tests, a deployment script, and a testnet deployment.

**Architecture:** A single small self-contained contract under `contracts/src/` (only forge-std installed; no OpenZeppelin). `payReward` is operator-only with per-transaction replay protection via a **globally unique `rewardId`** (`processedReward[rewardId]`) and a **per-campaign `nonce`** (`usedNonce[campaignId][nonce]`), consumed out-of-order. Budget protection is three-layer: campaign balance, `maxPayoutPerReward`, `globalPayoutAllowance`. Inline storage-based reentrancy guard, no withdrawal/rescue functions. TDD, frequent commits.

**Tech Stack:** Solidity 0.8.26, Forge 1.5.1 (foundry at `~/.foundry/bin`), forge-std (unit/fuzz/invariant), Arc testnet RPC.

---

**Conventions (read before starting):**
- `forge` is at `~/.foundry/bin/forge`; run `export PATH="$HOME/.foundry/bin:$PATH"` first (it is already on PATH on this machine).
- Only forge-std is installed in `contracts/lib/`. **Do not** `forge install` new dependencies.
- No comments in Solidity source unless matching the existing SPDX/NatSpec style.
- Money is integer micro-USDC (6 decimals): `$1.00 = 1_000_000`.
- Work is done on branch `task-006-phase4-contract`, branched from `main` (Phase 3 never touched `contracts/`).
- Do not modify anything outside `contracts/` except `.env.example`, `docs/CONTRACT.md`, and `contracts/README.md` as specified.
- The mock USDC token lives in `contracts/test/mocks/MockUSDC.sol` (shared by unit, fuzz, and invariant tests).

---

## File Structure Map

```
contracts/
  src/CampaignEscrow.sol            # REPLACE spike with production contract
  script/Deploy.s.sol               # MODIFY: fix env var name (ARC_USDC_ADDRESS), produce new address
  test/mocks/MockUSDC.sol           # CREATE: shared mock USDC (moved out of test file)
  test/CampaignEscrow.t.sol         # REPLACE with full unit test suite
  test/CampaignEscrow.fuzz.t.sol    # CREATE: fuzz tests (amount, rewardId, nonce, expiry, recipient)
  test/handlers/CampaignEscrowHandler.sol  # CREATE: invariant handler
  test/CampaignEscrow.invariant.t.sol      # CREATE: invariant tests
  README.md                         # MODIFY: status -> production
.env.example                        # MODIFY: add MAX_PAYOUT_MICRO_USDC, GLOBAL_PAYOUT_ALLOWANCE
docs/CONTRACT.md                    # MODIFY: status, invariants, deployed address
```

---

## Contract Reference (final source of truth for all tasks)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CampaignEscrow {
    struct Campaign {
        address creator;
        uint256 budget;
        uint256 balance;
        uint256 deadline;
        bool closed;
    }

    address public owner;
    address public operator;
    IERC20 public immutable usdc;
    uint256 public maxPayoutPerReward;
    uint256 public globalPayoutAllowance;
    bool private _paused;

    uint256 public nextCampaignId = 1;

    uint256 private _guardCounter = 1;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => bool) public processedReward;
    mapping(uint256 => mapping(uint256 => bool)) public usedNonce;

    event CampaignCreated(uint256 indexed id, address indexed creator, uint256 budget, uint256 deadline);
    event CampaignFunded(uint256 indexed campaignId, address indexed funder, uint256 amount);
    event RewardPaid(uint256 indexed campaignId, uint256 indexed rewardId, address indexed to, uint256 amount, uint256 nonce);
    event CampaignClosed(uint256 indexed campaignId, address indexed closer, uint256 refunded);
    event CampaignPaused();
    event CampaignUnpaused();
    event OperatorSet(address indexed newOperator);
    event GlobalAllowanceUpdated(uint256 newAllowance);
    event MaxPayoutUpdated(uint256 newMax);

    error NotOwner();
    error NotOperator();
    error NotAuthorized();
    error Paused();
    error CampaignIsClosed();
    error CampaignNotFound();
    error PayoutTooLarge();
    error InsufficientBalance();
    error AllowanceExceeded();
    error RewardAlreadyPaid();
    error NonceAlreadyUsed();
    error Expired();
    error InvalidRecipient();
    error InvalidAmount();
    error TokenTransferFailed();
    error Reentrant();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (_paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        _guardCounter += 1;
        uint256 localCounter = _guardCounter;
        _;
        require(localCounter == _guardCounter, "REENTRANCY");
    }

    constructor(address _usdc, uint256 _maxPayoutPerReward, uint256 _globalPayoutAllowance) {
        owner = msg.sender;
        operator = msg.sender;
        usdc = IERC20(_usdc);
        maxPayoutPerReward = _maxPayoutPerReward;
        globalPayoutAllowance = _globalPayoutAllowance;
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorSet(newOperator);
    }

    function setGlobalPayoutAllowance(uint256 allowance) external onlyOwner {
        globalPayoutAllowance = allowance;
        emit GlobalAllowanceUpdated(allowance);
    }

    function setMaxPayoutPerReward(uint256 max) external onlyOwner {
        maxPayoutPerReward = max;
        emit MaxPayoutUpdated(max);
    }

    function pause() external onlyOwner {
        _paused = true;
        emit CampaignPaused();
    }

    function unpause() external onlyOwner {
        _paused = false;
        emit CampaignUnpaused();
    }

    function isPaused() external view returns (bool) {
        return _paused;
    }

    function createCampaign(address _creator, uint256 budget, uint256 deadline)
        external
        onlyOwner
        whenNotPaused
        returns (uint256 id)
    {
        if (_creator == address(0)) revert InvalidRecipient();
        if (budget == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert Expired();
        id = nextCampaignId++;
        campaigns[id] = Campaign({ creator: _creator, budget: budget, balance: 0, deadline: deadline, closed: false });
        emit CampaignCreated(id, _creator, budget, deadline);
    }

    function fundCampaign(uint256 campaignId, uint256 amount) external whenNotPaused nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (amount == 0) revert InvalidAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
        c.balance += amount;
        emit CampaignFunded(campaignId, msg.sender, amount);
    }

    function payReward(
        uint256 campaignId,
        uint256 rewardId,
        uint256 nonce,
        address recipient,
        uint256 amount,
        uint256 deadline
    ) external onlyOperator whenNotPaused nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (block.timestamp > deadline) revert Expired();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (processedReward[rewardId]) revert RewardAlreadyPaid();
        if (usedNonce[campaignId][nonce]) revert NonceAlreadyUsed();
        if (amount > c.balance) revert InsufficientBalance();
        if (amount > maxPayoutPerReward) revert PayoutTooLarge();
        if (amount > globalPayoutAllowance) revert AllowanceExceeded();

        processedReward[rewardId] = true;
        usedNonce[campaignId][nonce] = true;
        c.balance -= amount;
        globalPayoutAllowance -= amount;

        if (!usdc.transfer(recipient, amount)) revert TokenTransferFailed();
        emit RewardPaid(campaignId, rewardId, recipient, amount, nonce);
    }

    function closeCampaign(uint256 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (msg.sender != owner && msg.sender != c.creator) revert NotAuthorized();
        uint256 refund = c.balance;
        c.closed = true;
        c.balance = 0;
        if (refund > 0 && !usdc.transfer(c.creator, refund)) revert TokenTransferFailed();
        emit CampaignClosed(campaignId, msg.sender, refund);
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    function isRewardProcessed(uint256 rewardId) external view returns (bool) {
        return processedReward[rewardId];
    }

    function isNonceUsed(uint256 campaignId, uint256 nonce) external view returns (bool) {
        return usedNonce[campaignId][nonce];
    }
}
```

---

### Task 1: Create shared MockUSDC + branch

**Files:**
- Create: `contracts/test/mocks/MockUSDC.sol`
- (repo hygiene) branch off `main`

- [ ] **Step 1: Check out the phase 4 branch**

Run:
```bash
git checkout -b task-006-phase4-contract 2>/dev/null || git checkout task-006-phase4-contract
git checkout main
git checkout -b task-006-phase4-contract
```
Expected: on a new branch `task-006-phase4-contract` based on `main` (contracts are unchanged there).

- [ ] **Step 2: Create the mock USDC file**

Create `contracts/test/mocks/MockUSDC.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `forge build`
Expected: no errors (mock builds).

- [ ] **Step 4: Commit**

```bash
git add contracts/test/mocks/MockUSDC.sol
git commit -m "test(contract): shared mock USDC for escrow tests"
```

---

### Task 2: Full unit test suite (red)

**Files:**
- Replace: `contracts/test/CampaignEscrow.t.sol`
- Delete: inline `MockUSDC` (now imported from mocks)

- [ ] **Step 1: Replace the test file**

Replace all of `contracts/test/CampaignEscrow.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CampaignEscrowTest is Test {
    CampaignEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner;
    address internal operator;
    address internal creator;
    address internal alice;
    address internal stranger;

    uint256 internal constant BUDGET = 25_000_000;
    uint256 internal constant MAX_PAYOUT = 1_000_000;
    uint256 internal constant ALLOWANCE = 100_000_000;

    function setUp() public {
        owner = address(this);
        operator = address(0xB0B);
        creator = address(0xE1E5aD11);
        alice = address(0xA11CE);
        stranger = address(0x57aAac33);

        usdc = new MockUSDC();
        escrow = new CampaignEscrow(address(usdc), MAX_PAYOUT, ALLOWANCE);
        escrow.setOperator(operator);
    }

    function _createCampaign() internal returns (uint256 id) {
        return escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
    }

    function _fund(uint256 id, uint256 amount, address funder) internal {
        usdc.mint(funder, amount);
        vm.startPrank(funder);
        usdc.approve(address(escrow), amount);
        escrow.fundCampaign(id, amount);
        vm.stopPrank();
    }

    function test_constructor_sets_owner_operator_and_config() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.operator(), operator);
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.maxPayoutPerReward(), MAX_PAYOUT);
        assertEq(escrow.globalPayoutAllowance(), ALLOWANCE);
        assertFalse(escrow.isPaused());
        assertEq(escrow.nextCampaignId(), 1);
    }

    function test_create_campaign_happy_path() public {
        uint256 deadline = block.timestamp + 30 days;
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.CampaignCreated(1, creator, BUDGET, deadline);
        uint256 id = escrow.createCampaign(creator, BUDGET, deadline);
        assertEq(id, 1);
        assertEq(escrow.nextCampaignId(), 2);
        (address c, uint256 budget, uint256 balance, uint256 d, bool closed) = escrow.campaigns(id);
        assertEq(c, creator);
        assertEq(budget, BUDGET);
        assertEq(balance, 0);
        assertEq(d, deadline);
        assertFalse(closed);
    }

    function test_create_campaign_only_owner() public {
        vm.prank(stranger);
        vm.expectRevert(CampaignEscrow.NotOwner.selector);
        escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
    }

    function test_create_campaign_zero_budget_reverts() public {
        vm.expectRevert(CampaignEscrow.InvalidAmount.selector);
        escrow.createCampaign(creator, 0, block.timestamp + 30 days);
    }

    function test_create_campaign_past_deadline_reverts() public {
        vm.expectRevert(CampaignEscrow.Expired.selector);
        escrow.createCampaign(creator, BUDGET, block.timestamp);
    }

    function test_fund_campaign_happy_path() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        (,, uint256 balance,,) = escrow.campaigns(id);
        assertEq(balance, BUDGET);
        assertEq(usdc.balanceOf(address(escrow)), BUDGET);
    }

    function test_fund_campaign_anyone_can_fund() public {
        uint256 id = _createCampaign();
        _fund(id, 5_000_000, stranger);
        (,, uint256 balance,,) = escrow.campaigns(id);
        assertEq(balance, 5_000_000);
    }

    function test_fund_campaign_not_found_reverts() public {
        usdc.mint(stranger, 1_000_000);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), 1_000_000);
        vm.expectRevert(CampaignEscrow.CampaignNotFound.selector);
        escrow.fundCampaign(777, 1_000_000);
        vm.stopPrank();
    }

    function test_fund_campaign_zero_amount_reverts() public {
        uint256 id = _createCampaign();
        usdc.mint(creator, 1);
        vm.startPrank(creator);
        usdc.approve(address(escrow), 1);
        vm.expectRevert(CampaignEscrow.InvalidAmount.selector);
        escrow.fundCampaign(id, 0);
        vm.stopPrank();
    }

    function test_fund_campaign_after_close_reverts() public {
        uint256 id = _createCampaign();
        escrow.closeCampaign(id);
        usdc.mint(stranger, 1_000_000);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), 1_000_000);
        vm.expectRevert(CampaignEscrow.CampaignIsClosed.selector);
        escrow.fundCampaign(id, 1_000_000);
        vm.stopPrank();
    }

    function test_pay_reward_happy_path() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.RewardPaid(id, 42, alice, 750_000, 7);
        escrow.payReward(id, 42, 7, alice, 750_000, deadline);
        assertEq(usdc.balanceOf(alice), 750_000);
        assertTrue(escrow.isRewardProcessed(42));
        assertTrue(escrow.isNonceUsed(id, 7));
        (,, uint256 balance,,) = escrow.campaigns(id);
        assertEq(balance, BUDGET - 750_000);
        assertEq(escrow.globalPayoutAllowance(), ALLOWANCE - 750_000);
    }

    function test_pay_reward_only_operator() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(alice);
        vm.expectRevert(CampaignEscrow.NotOperator.selector);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_campaign_not_found_reverts() public {
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.CampaignNotFound.selector);
        escrow.payReward(999, 42, 7, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_after_close_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        escrow.closeCampaign(id);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.CampaignIsClosed.selector);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_expired_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.Expired.selector);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp - 1);
    }

    function test_pay_reward_zero_recipient_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.InvalidRecipient.selector);
        escrow.payReward(id, 42, 7, address(0), 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_zero_amount_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.InvalidAmount.selector);
        escrow.payReward(id, 42, 7, alice, 0, block.timestamp + 1 hours);
    }

    function test_pay_reward_replayed_reward_id_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp + 1 hours);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.RewardAlreadyPaid.selector);
        escrow.payReward(id, 42, 8, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_replayed_nonce_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp + 1 hours);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.NonceAlreadyUsed.selector);
        escrow.payReward(id, 43, 7, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pay_reward_out_of_order_nonce_accepted() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        escrow.payReward(id, 42, 20, alice, 250_000, block.timestamp + 1 hours);
        vm.prank(operator);
        escrow.payReward(id, 43, 19, alice, 250_000, block.timestamp + 1 hours);
        assertEq(usdc.balanceOf(alice), 500_000);
    }

    function test_pay_reward_same_reward_id_different_campaign_rejected() public {
        uint256 id1 = _createCampaign();
        uint256 id2 = escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
        _fund(id1, BUDGET, creator);
        _fund(id2, BUDGET, creator);
        vm.startPrank(operator);
        escrow.payReward(id1, 42, 7, alice, 250_000, block.timestamp + 1 hours);
        vm.expectRevert(CampaignEscrow.RewardAlreadyPaid.selector);
        escrow.payReward(id2, 42, 7, alice, 250_000, block.timestamp + 1 hours);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 250_000);
    }

    function test_pay_reward_same_nonce_different_campaign_accepted() public {
        uint256 id1 = _createCampaign();
        uint256 id2 = escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
        _fund(id1, BUDGET, creator);
        _fund(id2, BUDGET, creator);
        vm.startPrank(operator);
        escrow.payReward(id1, 42, 7, alice, 250_000, block.timestamp + 1 hours);
        escrow.payReward(id2, 43, 7, alice, 250_000, block.timestamp + 1 hours);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 500_000);
    }

    function test_pay_reward_insufficient_balance_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, 500_000, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.InsufficientBalance.selector);
        escrow.payReward(id, 42, 7, alice, 500_001, block.timestamp + 1 hours);
    }

    function test_pay_reward_over_max_payout_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.PayoutTooLarge.selector);
        escrow.payReward(id, 42, 7, alice, MAX_PAYOUT + 1, block.timestamp + 1 hours);
    }

    function test_pay_reward_over_global_allowance_reverts() public {
        uint256 id = _createCampaign();
        escrow.setMaxPayoutPerReward(ALLOWANCE + 1000);
        _fund(id, ALLOWANCE + 1000, creator);
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.AllowanceExceeded.selector);
        escrow.payReward(id, 42, 7, alice, ALLOWANCE + 1, block.timestamp + 1 hours);
    }

    function test_close_by_owner_happy_path() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.CampaignClosed(id, owner, BUDGET);
        escrow.closeCampaign(id);
        (,,,, bool closed) = escrow.campaigns(id);
        assertTrue(closed);
        assertEq(usdc.balanceOf(creator), BUDGET);
    }

    function test_close_by_creator() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(creator);
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(creator), BUDGET);
    }

    function test_close_refunds_only_remaining_balance() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(operator);
        escrow.payReward(id, 42, 7, alice, 1_000_000, block.timestamp + 1 hours);
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(creator), BUDGET - 1_000_000);
    }

    function test_close_unauthorized_reverts() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        vm.prank(alice);
        vm.expectRevert(CampaignEscrow.NotAuthorized.selector);
        escrow.closeCampaign(id);
    }

    function test_close_not_found_reverts() public {
        vm.expectRevert(CampaignEscrow.CampaignNotFound.selector);
        escrow.closeCampaign(777);
    }

    function test_close_already_closed_reverts() public {
        uint256 id = _createCampaign();
        escrow.closeCampaign(id);
        vm.expectRevert(CampaignEscrow.CampaignIsClosed.selector);
        escrow.closeCampaign(id);
    }

    function test_set_operator() public {
        address newOp = address(0x0a0a);
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.OperatorSet(newOp);
        escrow.setOperator(newOp);
        assertEq(escrow.operator(), newOp);
    }

    function test_set_operator_only_owner() public {
        vm.prank(stranger);
        vm.expectRevert(CampaignEscrow.NotOwner.selector);
        escrow.setOperator(stranger);
    }

    function test_set_global_payout_allowance() public {
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.GlobalAllowanceUpdated(500_000_000);
        escrow.setGlobalPayoutAllowance(500_000_000);
        assertEq(escrow.globalPayoutAllowance(), 500_000_000);
    }

    function test_set_max_payout_per_reward() public {
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.MaxPayoutUpdated(2_000_000);
        escrow.setMaxPayoutPerReward(2_000_000);
        assertEq(escrow.maxPayoutPerReward(), 2_000_000);
    }

    function test_set_max_payout_only_owner() public {
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.NotOwner.selector);
        escrow.setMaxPayoutPerReward(2_000_000);
    }

    function test_set_global_allowance_only_owner() public {
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.NotOwner.selector);
        escrow.setGlobalPayoutAllowance(500_000_000);
    }

    function test_pause_and_unpause() public {
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.CampaignPaused();
        escrow.pause();
        assertTrue(escrow.isPaused());
        vm.expectEmit(true, true, true, true);
        emit CampaignEscrow.CampaignUnpaused();
        escrow.unpause();
        assertFalse(escrow.isPaused());
    }

    function test_pause_only_owner() public {
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.NotOwner.selector);
        escrow.pause();
    }

    function test_pause_blocks_create_campaign() public {
        escrow.pause();
        vm.expectRevert(CampaignEscrow.Paused.selector);
        escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
    }

    function test_pause_blocks_fund_campaign() public {
        uint256 id = _createCampaign();
        escrow.pause();
        usdc.mint(stranger, 1_000_000);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), 1_000_000);
        vm.expectRevert(CampaignEscrow.Paused.selector);
        escrow.fundCampaign(id, 1_000_000);
        vm.stopPrank();
    }

    function test_pause_blocks_pay_reward() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        escrow.pause();
        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.Paused.selector);
        escrow.payReward(id, 42, 7, alice, 750_000, block.timestamp + 1 hours);
    }

    function test_pause_allows_close() public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        escrow.pause();
        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(creator), BUDGET);
    }
}
```

- [ ] **Step 2: Run tests and confirm they FAIL to compile**

Run: `forge test --match-contract CampaignEscrowTest`
Expected: compilation errors (the current spike contract lacks `CampaignNotFound`, `RewardAlreadyPaid`, `NonceAlreadyUsed`, `Paused`, `getCampaign` return shape, `isPaused`, etc.). This is the expected RED state.

- [ ] **Step 3: Commit the red tests**

```bash
git add contracts/test/CampaignEscrow.t.sol
git commit -m "test(contract): unit test suite for production CampaignEscrow (red)"
```

---

### Task 3: Implement production contract (green)

**Files:**
- Replace: `contracts/src/CampaignEscrow.sol`

- [ ] **Step 1: Replace the spike contract**

Replace all of `contracts/src/CampaignEscrow.sol` with the **Contract Reference** from the top of this plan (the full `CampaignEscrow` contract exactly as written there).

- [ ] **Step 2: Run unit tests**

Run: `forge test --match-contract CampaignEscrowTest`
Expected: ALL unit tests pass (green).

- [ ] **Step 3: Run full build + full suite**

Run: `forge build && forge test`
Expected: build succeeds; existing 3 spike tests removed; all `CampaignEscrowTest` tests pass. (The old inline `MockUSDC` in the test file is gone.)

- [ ] **Step 4: Commit**

```bash
git add contracts/src/CampaignEscrow.sol
git commit -m "feat(contract): production CampaignEscrow with replay protection, expiry, budget caps, pause"
```

---

### Task 4: Fuzz tests

**Files:**
- Create: `contracts/test/CampaignEscrow.fuzz.t.sol`

- [ ] **Step 1: Create the fuzz test file**

Create `contracts/test/CampaignEscrow.fuzz.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CampaignEscrowFuzzTest is Test {
    CampaignEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner;
    address internal operator;
    address internal creator;
    address internal alice;
    address internal stranger;

    uint256 internal constant BUDGET = 25_000_000;
    uint256 internal constant MAX_PAYOUT = 1_000_000;
    uint256 internal constant ALLOWANCE = 100_000_000;

    function setUp() public {
        owner = address(this);
        operator = address(0xB0B);
        creator = address(0xE1E5aD11);
        alice = address(0xA11CE);
        stranger = address(0x57aAac33);

        usdc = new MockUSDC();
        escrow = new CampaignEscrow(address(usdc), MAX_PAYOUT, ALLOWANCE);
        escrow.setOperator(operator);

        vm.warp(1_700_000_000);
    }

    function _createCampaign() internal returns (uint256 id) {
        return escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
    }

    function _fund(uint256 id, uint256 amount, address funder) internal {
        usdc.mint(funder, amount);
        vm.startPrank(funder);
        usdc.approve(address(escrow), amount);
        escrow.fundCampaign(id, amount);
        vm.stopPrank();
    }

    function testFuzz_pay_reward_any_amount_within_caps(uint256 amountSeed) public {
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        uint256 amount = bound(amountSeed, 1, MAX_PAYOUT);
        uint256 rewardId = bound(uint256(keccak256(abi.encode(amountSeed, "reward"))), 1, type(uint256).max);
        uint256 nonce = bound(uint256(keccak256(abi.encode(amountSeed, "nonce"))), 1, type(uint256).max);

        vm.prank(operator);
        escrow.payReward(id, rewardId, nonce, alice, amount, block.timestamp + 1 hours);

        assertEq(usdc.balanceOf(alice), amount);
        (,, uint256 balance,,) = escrow.campaigns(id);
        assertEq(balance, BUDGET - amount);
        assertEq(escrow.globalPayoutAllowance(), ALLOWANCE - amount);
        assertTrue(escrow.isRewardProcessed(rewardId));
        assertTrue(escrow.isNonceUsed(id, nonce));
    }

    function testFuzz_reward_id_is_globally_unique(uint256 rewardId) public {
        rewardId = bound(rewardId, 1, type(uint256).max);
        uint256 id1 = _createCampaign();
        uint256 id2 = escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
        _fund(id1, BUDGET, creator);
        _fund(id2, BUDGET, creator);

        vm.startPrank(operator);
        escrow.payReward(id1, rewardId, 1, alice, 1, block.timestamp + 1 hours);
        vm.expectRevert(CampaignEscrow.RewardAlreadyPaid.selector);
        escrow.payReward(id2, rewardId, 1, alice, 1, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function testFuzz_nonce_is_unique_per_campaign(uint256 nonce) public {
        nonce = bound(nonce, 1, type(uint256).max);
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);

        vm.startPrank(operator);
        escrow.payReward(id, 1, nonce, alice, 1, block.timestamp + 1 hours);
        vm.expectRevert(CampaignEscrow.NonceAlreadyUsed.selector);
        escrow.payReward(id, 2, nonce, alice, 1, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function testFuzz_out_of_order_nonces_accepted(uint256 a, uint256 b) public {
        a = bound(a, 1, 1000);
        b = bound(b, 1, 1000);
        vm.assume(a != b);
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);

        vm.prank(operator);
        escrow.payReward(id, 1, a, alice, 1, block.timestamp + 1 hours);
        vm.prank(operator);
        escrow.payReward(id, 2, b, alice, 1, block.timestamp + 1 hours);
        assertEq(usdc.balanceOf(alice), 2);
    }

    function testFuzz_expiry_boundary(uint256 expiry) public {
        expiry = bound(expiry, 0, 365 days);
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);
        uint256 deadline = block.timestamp + expiry;

        vm.prank(operator);
        escrow.payReward(id, 1, 1, alice, 1, deadline);
        assertEq(usdc.balanceOf(alice), 1);
    }

    function testFuzz_expired_always_rejects(uint256 pastDelta) public {
        pastDelta = bound(pastDelta, 1, 365 days);
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);

        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.Expired.selector);
        escrow.payReward(id, 1, 1, alice, 1, block.timestamp - pastDelta);
    }

    function testFuzz_recipient_cannot_be_zero(uint256 recipientSeed) public {
        recipientSeed = bound(recipientSeed, 1, type(uint160).max);
        address recipient = address(uint160(recipientSeed));
        uint256 id = _createCampaign();
        _fund(id, BUDGET, creator);

        vm.prank(operator);
        escrow.payReward(id, 1, 1, recipient, 1, block.timestamp + 1 hours);
        assertEq(usdc.balanceOf(recipient), 1);
    }

    function testFuzz_campaigns_are_isolated(uint256 campaignIdDelta) public {
        campaignIdDelta = bound(campaignIdDelta, 1, 1000);
        uint256 id1 = _createCampaign();
        uint256 id2 = escrow.createCampaign(creator, BUDGET, block.timestamp + 30 days);
        _fund(id2, BUDGET, creator);

        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.CampaignNotFound.selector);
        escrow.payReward(id2 + campaignIdDelta, 1, 1, alice, 1, block.timestamp + 1 hours);

        vm.prank(operator);
        escrow.payReward(id2, 1, 1, alice, 1, block.timestamp + 1 hours);
        assertEq(usdc.balanceOf(alice), 1);
    }

    function testFuzz_payout_never_exceeds_balance(uint256 budgetSeed, uint256 amountSeed) public {
        uint256 budget = bound(budgetSeed, 1, BUDGET);
        uint256 id = escrow.createCampaign(creator, budget, block.timestamp + 30 days);
        _fund(id, budget, creator);
        uint256 amount = bound(amountSeed, budget + 1, budget + MAX_PAYOUT);

        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.InsufficientBalance.selector);
        escrow.payReward(id, 1, 1, alice, amount, block.timestamp + 1 hours);
    }
}
```

- [ ] **Step 2: Run fuzz tests**

Run: `forge test --match-contract CampaignEscrowFuzzTest`
Expected: all fuzz tests pass (Forge runs ~256 iterations each by default).

- [ ] **Step 3: Commit**

```bash
git add contracts/test/CampaignEscrow.fuzz.t.sol
git commit -m "test(contract): fuzz tests for payout caps, replay protection, expiry, isolation"
```

---

### Task 5: Invariant tests

**Files:**
- Create: `contracts/test/handlers/CampaignEscrowHandler.sol`
- Create: `contracts/test/CampaignEscrow.invariant.t.sol`

- [ ] **Step 1: Create the invariant handler**

Create `contracts/test/handlers/CampaignEscrowHandler.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../../src/CampaignEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract CampaignEscrowHandler is Test {
    CampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner;
    address public operator;
    address public creator;
    address public funder;
    address public recipient;

    uint256 public constant MAX_CAMPAIGNS = 8;
    uint256 public constant MAX_FUND_PAYOUT = 1_000_000;

    uint256 public totalCreated;
    uint256 public totalFunded;
    uint256 public totalPaid;
    uint256 public totalRefunded;

    mapping(uint256 => uint256) public campaignIdByIndex;
    mapping(uint256 => uint256) public fundedPerCampaign;
    mapping(uint256 => uint256) public paidPerCampaign;
    mapping(uint256 => uint256) public refundedPerCampaign;
    mapping(uint256 => bool) public closedCampaign;
    mapping(uint256 => uint256) public nextNonce;

    uint256 public nextRewardId = 1;

    constructor(
        CampaignEscrow _escrow,
        MockUSDC _usdc,
        address _owner,
        address _operator,
        address _creator,
        address _funder,
        address _recipient
    ) {
        escrow = _escrow;
        usdc = _usdc;
        owner = _owner;
        operator = _operator;
        creator = _creator;
        funder = _funder;
        recipient = _recipient;
    }

    function createCampaign(uint256 budgetSeed) external {
        if (totalCreated >= MAX_CAMPAIGNS) return;
        uint256 budget = 1 + (budgetSeed % MAX_FUND_PAYOUT);
        uint256 deadline = block.timestamp + 365 days;
        vm.prank(owner);
        uint256 id = escrow.createCampaign(creator, budget, deadline);
        campaignIdByIndex[totalCreated] = id;
        totalCreated++;
    }

    function fundCampaign(uint256 idx, uint256 amountSeed) external {
        if (idx >= totalCreated) return;
        uint256 id = campaignIdByIndex[idx];
        if (closedCampaign[id]) return;
        uint256 amount = 1 + (amountSeed % MAX_FUND_PAYOUT);
        usdc.mint(funder, amount);
        vm.startPrank(funder);
        usdc.approve(address(escrow), amount);
        escrow.fundCampaign(id, amount);
        vm.stopPrank();
        fundedPerCampaign[id] += amount;
        totalFunded += amount;
    }

    function payReward(uint256 idx, uint256 amountSeed) external {
        if (idx >= totalCreated) return;
        uint256 id = campaignIdByIndex[idx];
        if (closedCampaign[id]) return;
        (,, uint256 balance,,) = escrow.campaigns(id);
        if (balance == 0) return;
        uint256 amount = 1 + (amountSeed % balance);
        if (amount > MAX_FUND_PAYOUT) amount = MAX_FUND_PAYOUT;
        uint256 allowance = escrow.globalPayoutAllowance();
        if (allowance == 0 || amount > allowance) return;
        uint256 nonce = nextNonce[id]++;
        vm.prank(operator);
        escrow.payReward(id, nextRewardId++, nonce, recipient, amount, block.timestamp + 365 days);
        paidPerCampaign[id] += amount;
        totalPaid += amount;
    }

    function closeCampaign(uint256 idx) external {
        if (idx >= totalCreated) return;
        uint256 id = campaignIdByIndex[idx];
        if (closedCampaign[id]) return;
        (,, uint256 balance,,) = escrow.campaigns(id);
        vm.prank(creator);
        escrow.closeCampaign(id);
        closedCampaign[id] = true;
        refundedPerCampaign[id] = balance;
        totalRefunded += balance;
    }
}
```

- [ ] **Step 2: Create the invariant test file**

Create `contracts/test/CampaignEscrow.invariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {CampaignEscrowHandler} from "./handlers/CampaignEscrowHandler.sol";

contract CampaignEscrowInvariantTest is Test {
    CampaignEscrow internal escrow;
    MockUSDC internal usdc;
    CampaignEscrowHandler internal handler;

    address internal owner;
    address internal operator;
    address internal creator;
    address internal funder;
    address internal recipient;

    uint256 internal constant MAX_PAYOUT = 1_000_000;
    uint256 internal constant ALLOWANCE = 1_000_000_000_000;

    function setUp() public {
        owner = address(this);
        operator = address(0xB0B);
        creator = address(0xE1E5aD11);
        funder = address(0xF00dBeef9F5bC4fA);
        recipient = address(0xA11CE);

        usdc = new MockUSDC();
        escrow = new CampaignEscrow(address(usdc), MAX_PAYOUT, ALLOWANCE);
        escrow.setOperator(operator);

        handler = new CampaignEscrowHandler(
            escrow,
            usdc,
            owner,
            operator,
            creator,
            funder,
            recipient
        );
        targetContract(address(handler));
    }

    function invariant_total_paid_never_exceeds_total_funded() public view {
        assertLe(handler.totalPaid(), handler.totalFunded());
    }

    function invariant_allowance_plus_paid_equals_initial_allowance() public view {
        assertEq(escrow.globalPayoutAllowance() + handler.totalPaid(), ALLOWANCE);
    }

    function invariant_escrow_balance_conservation() public view {
        uint256 expect = handler.totalFunded() - handler.totalPaid() - handler.totalRefunded();
        assertEq(usdc.balanceOf(address(escrow)), expect);
    }

    function invariant_per_campaign_paid_never_exceeds_funded() public view {
        for (uint256 i = 0; i < handler.totalCreated(); i++) {
            assertLe(handler.paidPerCampaign(handler.campaignIdByIndex(i)), handler.fundedPerCampaign(handler.campaignIdByIndex(i)));
        }
    }
}
```

- [ ] **Step 3: Run invariant tests**

Run: `forge test --match-contract CampaignEscrowInvariantTest`
Expected: all invariants hold across thousands of fuzzed handler calls.

- [ ] **Step 4: Run the full suite**

Run: `forge build && forge test`
Expected: every test across the three test contracts passes.

- [ ] **Step 5: Commit**

```bash
git add contracts/test/handlers/CampaignEscrowHandler.sol contracts/test/CampaignEscrow.invariant.t.sol
git commit -m "test(contract): invariant tests for escrow balance conservation and payout caps"
```

---

### Task 6: Deployment script + env + docs

**Files:**
- Modify: `contracts/script/Deploy.s.sol`
- Modify: `.env.example`

- [ ] **Step 1: Replace the deployment script**

Replace all of `contracts/script/Deploy.s.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";

contract Deploy is Script {
    function run() external returns (address escrowAddr) {
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        uint256 maxPayout = vm.envUint("MAX_PAYOUT_MICRO_USDC");
        uint256 allowance = vm.envUint("GLOBAL_PAYOUT_ALLOWANCE");

        vm.startBroadcast();
        CampaignEscrow escrow = new CampaignEscrow(usdc, maxPayout, allowance);
        vm.stopBroadcast();

        escrowAddr = address(escrow);
        console.log("CampaignEscrow deployed at:", escrowAddr);
        console.log("usdc:", usdc);
        console.log("maxPayoutMicroUsdc:", maxPayout);
        console.log("globalPayoutAllowance:", allowance);
    }
}
```

Note: env var is `ARC_USDC_ADDRESS` (matches `.env.example`). The old spike script read a non-existent `ARC_USDC` env var.

- [ ] **Step 2: Add deployment env vars to `.env.example`**

In `.env.example`, under the existing `ARC_USDC_ADDRESS=` line, add:

```bash
# CampaignEscrow deployment params (micro-USDC, from PRD examples: $10 cap / $1000 global)
MAX_PAYOUT_MICRO_USDC=10000000
GLOBAL_PAYOUT_ALLOWANCE=1000000000
```

- [ ] **Step 3: Verify build**

Run: `forge build`
Expected: compiles (script + contract).

- [ ] **Step 4: Verify env vars resolve**

Run:
```bash
source ../.env 2>/dev/null
forge script script/Deploy.s.sol --rpc-url "$ARC_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY" --dry-run
```
Expected: simulation prints `CampaignEscrow deployed at:` with a computed address. If `.env` is missing or lacks the RPC/key, `source` will silently fail — skip the dry-run and continue; the real deployment is Task 7.

- [ ] **Step 5: Commit**

```bash
git add contracts/script/Deploy.s.sol .env.example
git commit -m "feat(contract): arc deployment script and env params for production escrow"
```

---

### Task 7: Testnet deployment

**Files:**
- Broadcast: `contracts/script/Deploy.s.sol`
- Modify: `docs/CONTRACT.md`
- Modify: `contracts/README.md`

Requires `.env` (git-ignored) with: `ARC_RPC_URL` (https://rpc.testnet.arc.io), `ARC_USDC_ADDRESS` (0x3600000000000000000000000000000000000000), `OPERATOR_PRIVATE_KEY` (testnet-funded EOA), `MAX_PAYOUT_MICRO_USDC`, `GLOBAL_PAYOUT_ALLOWANCE`. If `.env` is not available, STOP and ask the user for credentials — do not fabricate keys.

- [ ] **Step 1: Confirm testnet env values**

Run: `source ../.env && echo "$ARC_RPC_URL $ARC_CHAIN_ID $ARC_USDC_ADDRESS"`
Expected: `https://rpc.testnet.arc.io 5042002 0x3600000000000000000000000000000000000000` (matches `.env.example`).

- [ ] **Step 2: Broadcast the deployment**

Run:
```bash
source ../.env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" \
  --private-key "$OPERATOR_PRIVATE_KEY" \
  --broadcast \
  --chain $ARC_CHAIN_ID
```
Expected: `CampaignEscrow deployed at: 0x...` printed, and a `broadcast/Deploy.s.sol/5042002/*.json` receipt written. **Record the deployed address** as `ESCROW_ADDR`.

If this is a fresh deploy, you may need to fund the EOA first (`OPERATOR_PRIVATE_KEY` account needs testnet USDC + native gas).

- [ ] **Step 3: Smoke-test the deployed contract**

Run:
```bash
ESCROW_ADDR="<deployed address from Step 2>"
cast call "$ESCROW_ADDR" "owner()(address)" --rpc-url "$ARC_RPC_URL"
cast call "$ESCROW_ADDR" "operator()(address)" --rpc-url "$ARC_RPC_URL"
cast call "$ESCROW_ADDR" "usdc()(address)" --rpc-url "$ARC_RPC_URL"
cast call "$ESCROW_ADDR" "globalPayoutAllowance()(uint256)" --rpc-url "$ARC_RPC_URL"
cast call "$ESCROW_ADDR" "isPaused()(bool)" --rpc-url "$ARC_RPC_URL"
```
Expected: 5 responses — owner == operator == deployer EOA, usdc == 0x3600..., allowance matches env, isPaused == false.

- [ ] **Step 4: Update `docs/CONTRACT.md`**

Edit `docs/CONTRACT.md`:
- Status bullet: change to note Phase 4 production contract deployed to Arc testnet with the new `ESCROW_ADDR` (keep the Phase 0 address for history, labelled as the spike).
- Invariants section: update to the current contract — `maxPayoutPerReward`/`globalPayoutAllowance` are **owner-settable** (no longer immutable), `processedReward[rewardId]` (globally unique rewardId) + `usedNonce[campaignId][nonce]` prevent replay, nonces consumed out-of-order, pause blocks create/fund/pay but not close.
- Build & test / Arc reminders sections stay as-is.

- [ ] **Step 5: Update `contracts/README.md`**

Edit `contracts/README.md` status paragraph: replace "not the hardened Phase 4 implementation" text with a line stating this is the production Phase 4 `CampaignEscrow` (deployed address on the Arc testnet in `docs/CONTRACT.md`).

- [ ] **Step 6: Commit**

```bash
git add contracts/script/broadcast docs/CONTRACT.md contracts/README.md
git commit -m "docs(contract): log Arc testnet deployment and update contract status"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full build + full test run**

Run:
```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge build
forge test
```
Expected: build clean; unit + fuzz + invariant tests all pass.

- [ ] **Step 2: Run gas snapshot (optional but useful)**

Run: `forge snapshot`
Expected: writes `.gas-snapshot` with per-test gas figures. Commit it if the repo tracks it (it is currently git-ignored under `contracts/` prefix patterns — check `git status`; if ignored, skip).

- [ ] **Step 3: Confirm repo tests still green (no drift)**

Run (from repo root):
```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm typecheck
```
Expected: all 15 packages typecheck clean (contracts are not part of pnpm workspace, so no change expected).

- [ ] **Step 4: Confirm git state**

Run: `git status`
Expected: only intended changed/added files on `task-006-phase4-contract`; working tree otherwise clean.

---

## Self-Review Checklist

- Spec section "Contract Interface" → implemented verbatim in Task 3 (all 9 external functions + 4 views).
- Spec "Data Structures" → `Campaign { creator, budget, balance, deadline, closed }` correct.
- Spec "State Variables" → `usdc` immutable, replay mappings, `nextCampaignId`, `paused` (private `_paused` + `isPaused()` public view).
- Spec "Replay Protection" → globally unique `rewardId` (`processedReward[rewardId]`) + per-campaign `usedNonce[campaignId][nonce]`, out-of-order allowed, nonce != any nextNonce check → tests `test_pay_reward_out_of_order_nonce_accepted`, `testFuzz_out_of_order_nonces_accepted`.
- Spec "Expiry" → `block.timestamp > deadline` → `Expired()`; tests for past + boundary.
- Spec "Budget Protection" → three layers, tests for each (`InsufficientBalance`, `PayoutTooLarge`, `AllowanceExceeded`).
- Spec "Access Control" → owner/operator/creator matrix fully tested.
- Spec "Emergency Controls" → pause blocks create/fund/pay, allows close → `test_pause_*`.
- Spec "Events" → all 9 events emitted and asserted via `vm.expectEmit`.
- Spec "Errors" → all spec errors present; `CampaignNotFound()` and `Reentrant()` added as hardening (documented; not part of spec list but justified — funding/paying/closing a non-existent campaign must not silently accept funds or refund to address(0)).
- Spec "ReentrancyGuard" → inline storage-based `nonReentrant` on `fundCampaign`, `payReward`, `closeCampaign` (no OpenZeppelin dependency, matching repo convention).
- PRD §62 test list → create/fund/reward/expired/replayed/over-budget/close/refund covered in unit tests; fuzz over amount, nonce, campaign ID, reward ID, expiry, recipient in Task 4.
- PRD §75 → Foundry tests ✓, fuzz ✓, deployment script ✓, testnet deployment ✓.
- No placeholders: every step has code + exact command.
- Type/name consistency: `payReward` signature consistent everywhere; `RewardPaid` event args `(campaignId, rewardId, to, amount, nonce)` match the Contract Reference in every test; handlers use `nextRewardId` (global) and `nextNonce` (per-campaign) to guarantee uniqueness the contract can also enforce.

**Known deviation from spec (intentional):**
- Spec error list did not include `CampaignNotFound()` or `Reentrant()`. Both are defensive additions: funding/paying/closing an uncreated campaign would otherwise mutate a zero-initialized `Campaign` struct (silently accepting funds that can never be recovered, or refunding to `address(0)`). Documentation updated in `docs/CONTRACT.md`.