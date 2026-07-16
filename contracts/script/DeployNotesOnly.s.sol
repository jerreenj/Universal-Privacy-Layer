// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Script, console2} from "forge-std/Script.sol";
import {ConfidentialNotes} from "../src/ConfidentialNotes.sol";

contract DeployNotesOnly is Script {
    function run() external {
        address verifier = 0x9DBDB7cC200B83Fa6C9673857058bC86Bf77773C;
        vm.startBroadcast();
        ConfidentialNotes notes = new ConfidentialNotes(verifier, msg.sender);
        console2.log("ConfidentialNotes:", address(notes));
        vm.stopBroadcast();
    }
}
