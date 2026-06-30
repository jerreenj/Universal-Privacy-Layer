// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {PrivacyRelayer} from "../src/PrivacyRelayer.sol";

/// @notice P2.9.7 single-contract redeploy — redeploys ONLY PrivacyRelayer with
///         the new atomic `relayAndAnnounce` entry point, then wires it to the
///         EXISTING StealthAddressRegistry (which is permissionless + stateful
///         and must NOT be redeployed — old announcements stay valid).
///
/// @dev Unlike Deploy.s.sol (which deploys all 3 contracts and overwrites the
///      manifest from scratch), this script:
///        1. Reads the existing `deployed_base.json` to recover the live
///           `stealth_registry` address (so it can be wired to the new relayer).
///        2. Deploys the new PrivacyRelayer.
///        3. Calls `setRegistry(<existing registry>)` on the new instance IN THE
///           SAME broadcast so the new contract is immediately atomic-ready.
///        4. Logs the new address. Manifest update is done in a post-broadcast
///           step (NOT inside Forge) — foundry's vm.parseJson + vm.serialize*
///           share internal JSON-builder state, so a parse-then-rewrite round
///           trip inside one script corrupts the file. The caller updates
///           `privacy_relayer` in deployed_base.json after broadcast, mirroring
///           how deploy_base.sh enriches provenance.
///
///      The old PrivacyRelayer's accrued fees are NOT touched here — the owner
///      can recover them via `withdrawFees()` on the old contract afterwards.
///
/// Run via:
///   forge script script/RedeployRelayer.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
///
/// fs_permissions in foundry.toml grants read to ./deployed_base.json — required
/// for the vm.readFile that recovers the existing registry address.
contract RedeployRelayerScript is Script {
    function run() external {
        // ── 1. Recover the existing registry address from the manifest ────────
        // The manifest shape is {"base": {"privacy_relayer", "stealth_registry",
        // "uniswap_wrapper", "chainId", ...}}. We only need the registry here.
        string memory manifest = vm.readFile("deployed_base.json");
        address existingRegistry = vm.parseJsonAddress(manifest, ".base.stealth_registry");
        require(existingRegistry != address(0), "existing stealth_registry missing from manifest");

        address deployer = msg.sender;
        console2.log("=== UPL P2.9.7 Redeploy PrivacyRelayer (Base, chainId 8453) ===");
        console2.log("Deployer (owner + relayer):", deployer);
        console2.log("Existing StealthAddressRegistry (preserved):", existingRegistry);
        console2.log("");

        vm.startBroadcast();

        // 2. Deploy the new PrivacyRelayer — zero args; deployer becomes owner +
        //    relayer (same constructor behaviour as the original deploy).
        PrivacyRelayer relayer = new PrivacyRelayer();
        console2.log("New PrivacyRelayer deployed:", address(relayer));
        console2.log("  owner:", relayer.owner());
        console2.log("  relayer:", relayer.relayer());

        // 3. Wire the existing registry in the SAME broadcast so the new contract
        //    is atomic-ready immediately on confirmation. Owner = deployer here.
        relayer.setRegistry(existingRegistry);
        console2.log("  registry wired:", relayer.registry());

        vm.stopBroadcast();

        console2.log("");
        console2.log("NEW_PRIVACY_RELAYER=%s", address(relayer));
        console2.log("=== Redeploy complete. Update deployed_base.json + verify on Basescan. ===");
    }
}
