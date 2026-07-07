// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/ConfidentialReverseSwap.sol";

/**
 * @notice One-off broadcast for ConfidentialReverseSwap on Base.
 *         Defaults to:
 *           USDC       = canonical Base USDC
 *           FEE        = deployer
 *           RELAYER    = the same hot-wallet the PrivacyRelayer uses
 *           RATE       = 1_700_000_000 (1700 USDC/ETH in 6-dec units)
 *
 *         ENV overrides:
 *           CONFIDENTIAL_REVERSE_USDC
 *           FEE_RECIPIENT
 *           RELAYER_ADDRESS (REQUIRED)
 *           CONFIDENTIAL_REVERSE_RATE
 */
contract DeployConfidentialReverseSwapScript is Script {
    address constant DEFAULT_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant DEFAULT_RATE = 1_700_000_000;

    function run() external {
        address usdc = vm.envOr("CONFIDENTIAL_REVERSE_USDC", DEFAULT_USDC);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        uint256 rate = vm.envOr("CONFIDENTIAL_REVERSE_RATE", DEFAULT_RATE);
        require(feeRecipient != address(0), "FEE_RECIPIENT required");
        require(relayer != address(0), "RELAYER_ADDRESS required");
        require(rate > 0, "rate=0");

        console2.log("=== UPL - Deploy ConfidentialReverseSwap on Base ===");
        console2.log("USDC:");
        console2.log(usdc);
        console2.log("Fee:");
        console2.log(feeRecipient);
        console2.log("Relayer:");
        console2.log(relayer);
        console2.log("Rate:");
        console2.log(rate);

        vm.startBroadcast();
        ConfidentialReverseSwap v = new ConfidentialReverseSwap(usdc, feeRecipient, relayer, rate, msg.sender);
        vm.stopBroadcast();

        console2.log("Deployed:");
        console2.log(address(v));
        console2.log("UPL_CONFIDENTIAL_REVERSE_SWAP_ADDR=");
        console2.log(address(v));
        console2.log("Note: vault starts with 0 ETH. Operator must fund");
        console2.log("the vault with ETH via direct transfer or");
        console2.log("a cast send <addr> --value <eth> to make payouts.");
    }
}
