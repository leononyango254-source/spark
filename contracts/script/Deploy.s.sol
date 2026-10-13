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
