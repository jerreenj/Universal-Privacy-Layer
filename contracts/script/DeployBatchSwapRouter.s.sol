// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {BatchSwapRouter} from "../src/BatchSwapRouter.sol";

contract DeployBatchSwapRouter is Script {
    // Base mainnet addresses
    address constant AAVE_PROVIDER = 0xa238Dd80c259a72E81D7E4664A980159B1977032;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);

        BatchSwapRouter router = new BatchSwapRouter(AAVE_PROVIDER, USDC);
        console.log("BatchSwapRouter deployed at:", address(router));

        vm.stopBroadcast();
    }
}
