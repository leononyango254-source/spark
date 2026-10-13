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
