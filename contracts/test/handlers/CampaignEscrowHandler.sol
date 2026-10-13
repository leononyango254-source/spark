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
