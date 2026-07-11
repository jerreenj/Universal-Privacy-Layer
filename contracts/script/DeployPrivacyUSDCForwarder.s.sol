// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {PrivacyUSDCForwarder} from "../src/PrivacyUSDCForwarder.sol";

/// @notice Deploys ONLY PrivacyUSDCForwarder on Base mainnet.
///
///         Mirrors RedeployRelayer.s.sol — clean single-contract deploy.
///         The constructor sets the deployer as owner + relayer; the deployer
///         rotates the relayer role to the production relayer hot wallet via
///         `setRelayer()` once the customer-pilot relayer service is online.
///
/// Run via:
///   forge script script/DeployPrivacyUSDCForwarder.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast \
///     --verify --etherscan-api-key $BASESCAN_API_KEY
contract DeployPrivacyUSDCForwarderScript is Script {
    function run() external {
        address deployer = msg.sender;
        console2.log("=== UPL PrivacyUSDCForwarder deploy (Base, chainId 8453) ===");
        console2.log("Deployer (owner + initial relayer):", deployer);
        console2.log("");

        vm.startBroadcast();
        PrivacyUSDCForwarder fwd = new PrivacyUSDCForwarder();
        console2.log("PrivacyUSDCForwarder deployed:", address(fwd));
        console2.log("  owner:", fwd.owner());
        console2.log("  relayer:", fwd.relayer());
        console2.log("  EIP-712 NAME:", fwd.NAME());
        console2.log("");
        vm.stopBroadcast();

        console2.log("PRIVACY_USDC_FORWARDER=%s", address(fwd));
        console2.log("");
        console2.log("Post-deploy steps:");
        console2.log("  1. Set relayer role to production hot wallet:");
        console2.log("     cast send <addr> 'setRelayer(address)' <relayer> --rpc-url <rpc>");
        console2.log("  2. Verify on BaseScan (if --verify was used above)");
        console2.log("  3. Update deployed_base.json with the address above");
        console2.log("  4. Wire backend /api/usdc-forwarder/* endpoints to this address");
        console2.log("=== Deploy complete ===");
    }
}
