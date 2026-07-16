// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {NoteSettlement} from "../src/NoteSettlement.sol";

/// @notice Deploys NoteSettlement on Base mainnet. The verifier address
///         is the generated Groth16 verifier for the confidential_spend
///         circuit. For now we deploy with a placeholder and update
///         after the circuit is compiled + trusted setup.
///
/// Run via:
///   forge script script/DeployNoteSettlement.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
contract DeployNoteSettlementScript is Script {
    // Real SpendVerifier address — deployed on Base mainnet.
    address constant SPEND_VERIFIER = 0x9a3a3C447320634F2FCc35DB522f6978490bAC7b;

    function run() external {
        address deployer = msg.sender;
        console2.log("=== UPL NoteSettlement deploy (Base, chainId 8453) ===");
        console2.log("Deployer (owner):", deployer);

        vm.startBroadcast();
        NoteSettlement settlement = new NoteSettlement(SPEND_VERIFIER);
        console2.log("NoteSettlement deployed:", address(settlement));
        console2.log("  owner:", settlement.owner());
        console2.log("  USDC:", settlement.USDC());
        vm.stopBroadcast();

        console2.log("NOTE_SETTLEMENT=%s", address(settlement));
        console2.log("=== Deploy complete ===");
    }
}
