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