// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ConfidentialNotes} from "../src/ConfidentialNotes.sol";

contract DeployNotesOnly is Script {
    function run() external {
        address verifier = 0x9f3c6358f65B87C4b555E5E6F2038B5d83904132;
        vm.startBroadcast();
        ConfidentialNotes notes = new ConfidentialNotes(verifier, msg.sender);
        console2.log("ConfidentialNotes deployed:", address(notes));
        vm.stopBroadcast();
    }
}
