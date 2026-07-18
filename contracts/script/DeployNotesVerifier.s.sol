// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ConfidentialNotes} from "../src/ConfidentialNotes.sol";
import {ConfidentialNotesVerifier} from "../src/ConfidentialNotesVerifier.sol";

contract DeployNotesVerifier is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // 1. Deploy new verifier from current notes_final.zkey
        ConfidentialNotesVerifier verifier = new ConfidentialNotesVerifier();
        console2.log("ConfidentialNotesVerifier:", address(verifier));

        // 2. Deploy ConfidentialNotes with new verifier
        ConfidentialNotes notes = new ConfidentialNotes(address(verifier), deployer);
        console2.log("ConfidentialNotes:", address(notes));
        console2.log("Owner:", deployer);

        vm.stopBroadcast();
    }
}
