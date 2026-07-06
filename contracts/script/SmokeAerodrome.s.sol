// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {AerodromePrivacyWrapper, IAerodromeRouter} from "../src/AerodromePrivacyWrapper.sol";

/// @notice ONE-OFF script that broadcasts a single
///         AerodromePrivacyWrapper.privateSwapETHForToken(...) tx on
///         Base mainnet as part of the P4.2 end-to-end smoke test.
/// Run via:
///   set -a && source contracts/.env && set +a
///   forge script script/SmokeAerodrome.s.sol \
///     --rpc-url https://mainnet.base.org \
///     --broadcast \
///     -vvvvv
contract SmokeAerodromeScript is Script {
    // New wrapper address is filled in after the redeploy — pass via env.
    address wrapperAddr = vm.envOr("WRAPPER", address(0));
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Aerodrome V2 PoolFactory on Base — used for both stable + volatile
    // pools. See contracts/script/DeployAerodrome.s.sol for the
    // canonical source-of-truth (and AerodromeFactoryRegistry / Router
    // probing notes).
    address constant AERODROME_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    // Use the deployer's own address as the recipient so this smoke
    // test is a self-tx (deployer pays gas + receives USDC). In a
    // real customer flow the recipient would be a stealth address
    // from /api/stealth/generate.
    address constant RECIPIENT = 0x3f44A6451439673D95082A1337045a25ec275394;
    uint256 constant AMOUNT_IN = 1e14; // 0.0001 ETH

    function run() external {
        require(wrapperAddr != address(0), "WRAPPER env var not set -- redeploy via DeployAerodrome.s.sol first");

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from: WETH,
            to: USDC,
            stable: false, // volatile WETH/USDC pool
            factory: AERODROME_FACTORY // REQUIRED — Aerodrome V2's Route struct has 4 fields
        });

        uint256 deadline = block.timestamp + 15 minutes;
        vm.startBroadcast();
        (bool ok, bytes memory ret) = address(wrapperAddr).call{value: AMOUNT_IN}(
            abi.encodeWithSelector(
                AerodromePrivacyWrapper.privateSwapETHForToken.selector,
                USDC,
                routes,
                0, // amountOutMinimum = 0 (no slippage cap; demo)
                RECIPIENT,
                deadline
            )
        );
        vm.stopBroadcast();
        if (!ok) {
            console2.log("Smoke call reverted; revert reason (best-effort decode):");
            console2.logBytes(ret);
            revert("SmokeAerodrome failed");
        }
        console2.log("Smoke ok; raw return length:", ret.length);
    }
}
