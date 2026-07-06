// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {AerodromePrivacyWrapper} from "../src/AerodromePrivacyWrapper.sol";

/// @notice One-off P4.2 Aerodrome wrapper broadcast.
///         The full Deploy.s.sol deploys EVERY contract (registry, relayer,
///         BOTH wrappers, verifier, pool) — wasteful when only the new
///         wrapper is missing. This script deploys JUST the wrapper to keep
///         the gas cost to ~0.000002 ETH (~USD 0.005).
///
///         Run via:
///         forge script script/DeployAerodrome.s.sol \
///           --rpc-url $BASE_RPC_URL \
///           --private-key $DEPLOYER_PRIVATE_KEY \
///           --broadcast
///
///         Required env:
///           BASE_RPC_URL       (default https://mainnet.base.org)
///           DEPLOYER_PRIVATE_KEY
///           AERODROME_ROUTER   (default 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43)
///           WETH               (default 0x4200000000000000000000000000000000000006)
///           FEE_RECIPIENT      (the existing 0x3f44A6451439673D95082A1337045a25ec275394)
contract DeployAerodromeScript is Script {
    address constant DEFAULT_AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant DEFAULT_WETH             = 0x4200000000000000000000000000000000000006;
    // The canonical feeRecipient, deployer — same as the other P4.1 wrappers.
    address constant DEFAULT_FEE_RECIPIENT    = 0x3f44A6451439673D95082A1337045a25ec275394;
    uint256 constant BASE_CHAIN_ID            = 8453;

    function run() external {
        address aerodromeRouter = vm.envOr("AERODROME_ROUTER", DEFAULT_AERODROME_ROUTER);
        address weth            = vm.envOr("WETH", DEFAULT_WETH);
        address feeRecipient    = vm.envAddress("FEE_RECIPIENT"); // required (IMMUTABLE)
        require(feeRecipient != address(0), "FEE_RECIPIENT must not be zero (IMMUTABLE)");

        address deployer = msg.sender;
        console2.log("=== UPL - Deploy AerodromePrivacyWrapper on Base ===");
        console2.log("Deployer:", deployer);
        console2.log("AerodromeRouter:", aerodromeRouter);
        console2.log("WETH:", weth);
        console2.log("feeRecipient (IMMUTABLE):", feeRecipient);

        vm.startBroadcast();
        AerodromePrivacyWrapper aeroWrapper = new AerodromePrivacyWrapper(
            aerodromeRouter,
            weth,
            feeRecipient
        );
        vm.stopBroadcast();

        console2.log("AerodromePrivacyWrapper deployed:", address(aeroWrapper));
        console2.log("  aerodromeRouter():", aeroWrapper.aerodromeRouter());
        console2.log("  WETH():", aeroWrapper.WETH());
        console2.log("  feeRecipient():", aeroWrapper.feeRecipient());
        console2.log("=== Done. Add this address to deployed_base.json manually. ===");
    }
}
