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