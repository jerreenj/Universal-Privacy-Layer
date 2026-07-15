// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {CurveSwapRouter} from "../src/CurveSwapRouter.sol";

contract DeployCurveSwapRouterScript is Script {
    function run() external {
        address deployer = msg.sender;
        console2.log("=== UPL CurveSwapRouter deploy (Base, chainId 8453) ===");
        console2.log("Deployer (owner):", deployer);

        vm.startBroadcast();
        CurveSwapRouter router = new CurveSwapRouter();
        console2.log("CurveSwapRouter deployed:", address(router));
        console2.log("  owner:", router.owner());
        console2.log("  Curve:", router.CURVE_POOL());
        console2.log("  WETH:", router.WETH());
        console2.log("  USDC:", router.USDC());
        vm.stopBroadcast();

        console2.log("CURVE_SWAP_ROUTER=%s", address(router));
        console2.log("=== Deploy complete ===");
    }
}
