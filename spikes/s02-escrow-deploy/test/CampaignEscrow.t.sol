// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";

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

contract CampaignEscrowTest is Test {
    CampaignEscrow escrow;
    MockUSDC usdc;

    address owner = address(this);
    address operator = address(0x0B0B);
    address creator = address(0xC1);
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new CampaignEscrow(address(usdc), 1_000_000, 25_000_000);
        escrow.setOperator(operator);
    }

    function test_CreateFundPayClose() public {
        uint256 id = escrow.createCampaign(creator, 25_000_000, block.timestamp + 30 days);

        usdc.mint(owner, 25_000_000);
        usdc.approve(address(escrow), 25_000_000);
        escrow.fundCampaign(id, 25_000_000);

        vm.prank(operator);
        escrow.payReward(id, alice, 100_000, 1);

        (,, uint256 balance,,) = escrow.campaigns(id);
        assertEq(balance, 24_900_000, "balance after one reward");
        assertEq(usdc.balanceOf(alice), 100_000, "alice paid");
        assertEq(escrow.globalPayoutAllowance(), 24_900_000, "allowance consumed");

        escrow.closeCampaign(id);
        assertEq(usdc.balanceOf(creator), 24_900_000, "creator refunded");
    }

    function test_PayoutCapEnforced() public {
        uint256 id = escrow.createCampaign(creator, 25_000_000, block.timestamp + 30 days);
        usdc.mint(owner, 25_000_000);
        usdc.approve(address(escrow), 25_000_000);
        escrow.fundCampaign(id, 25_000_000);

        vm.prank(operator);
        vm.expectRevert(CampaignEscrow.PayoutTooLarge.selector);
        escrow.payReward(id, alice, 1_000_001, 1);
    }

    function test_OnlyOperatorCanPay() public {
        uint256 id = escrow.createCampaign(creator, 25_000_000, block.timestamp + 30 days);
        usdc.mint(owner, 25_000_000);
        usdc.approve(address(escrow), 25_000_000);
        escrow.fundCampaign(id, 25_000_000);

        vm.expectRevert(CampaignEscrow.NotOperator.selector);
        escrow.payReward(id, alice, 100_000, 1);
    }
}
