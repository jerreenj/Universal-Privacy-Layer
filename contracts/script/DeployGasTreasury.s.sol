// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GasTreasury} from "../src/GasTreasury.sol";

/// @notice Deploys GasTreasury on Base mainnet. The deployer becomes
///         the owner — the backend uses the deployer key to call
///         fundRelayer() during relayer rotation.
///
/// Run via:
///   forge script script/DeployGasTreasury.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast --verify --etherscan-api-key $BASESCAN_API_KEY
///
/// After deploy:
///   1. Send ETH to the treasury address (one-time funding)
///   2. Update deployed_base.json with gas_treasury address
///   3. Backend auto-funds relayers from this treasury
contract DeployGasTreasuryScript is Script {
    function run() external {
        address deployer = msg.sender;
        console2.log("=== UPL GasTreasury deploy (Base, chainId 8453) ===");
        console2.log("Deployer (owner):", deployer);

        vm.startBroadcast();
        GasTreasury treasury = new GasTreasury();
        console2.log("GasTreasury deployed:", address(treasury));
        console2.log("  owner:", treasury.owner());
        console2.log("  GAS_TOPUP:", treasury.GAS_TOPUP());
        vm.stopBroadcast();

        console2.log("");
        console2.log("GAS_TREASURY=%s", address(treasury));
        console2.log("");
        console2.log("Post-deploy:");
        console2.log("  1. Send ETH to this address (one-time gas funding)");
        console2.log("  2. Update deployed_base.json: gas_treasury = <address>");
        console2.log("  3. Backend reads this and auto-funds relayers");
        console2.log("=== Deploy complete ===");
    }
}
