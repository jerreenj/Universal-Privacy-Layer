// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {FlashSwapRouter} from "../src/FlashSwapRouter.sol";

/// @notice Deploys FlashSwapRouter on Base mainnet. No constructor args.
contract DeployFlashSwapRouterScript is Script {
    function run() external {
        address deployer = msg.sender;
        console2.log("=== UPL FlashSwapRouter deploy (Base, chainId 8453) ===");
        console2.log("Deployer (owner):", deployer);

        vm.startBroadcast();
        FlashSwapRouter router = new FlashSwapRouter();
        console2.log("FlashSwapRouter deployed:", address(router));
        console2.log("  owner:", router.owner());
        console2.log("  Morpho:", router.MORPHO());
        console2.log("  Curve:", router.CURVE_POOL());
        console2.log("  WETH:", router.WETH());
        console2.log("  USDC:", router.USDC());
        vm.stopBroadcast();

        console2.log("FLASH_SWAP_ROUTER=%s", address(router));
        console2.log("=== Deploy complete ===");
    }
}
