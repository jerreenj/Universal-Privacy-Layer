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
///           BASE_RPC_URL              (default https://mainnet.base.org)
///           DEPLOYER_PRIVATE_KEY
///           AERODROME_ROUTER          (default 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43)
///           WETH                      (default 0x4200000000000000000000000000000000000006)
///           AERODROME_VOLATILE_FACTORY (default 0x420DD381b31aEf6683db6B902084cB0FFECe40Da)
///           AERODROME_STABLE_FACTORY   (default 0x420DD381b31aEf6683db6B902084cB0FFECe40Da)
///           FEE_RECIPIENT             (the existing 0x3f44A6451439673D95082A1337045a25ec275394)
///
/// P4.2 hotfix (2026-07-06):
///   This deploy uses the new 5-arg constructor that takes the Aerodrome
///   PoolFactory (volatile + stable) addresses. The previous broadcast
///   used a 3-arg constructor whose Route struct was missing the
///   `factory` field — every real call reverted inside Aerodrome Router
///   with empty error data. The redeploy is the only way to fix the
///   mis-aligned ABI encoding (the contract is not upgradeable).
contract DeployAerodromeScript is Script {
    address constant DEFAULT_AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant DEFAULT_WETH = 0x4200000000000000000000000000000000000006;
    // Aerodrome V2 on Base uses ONE PoolFactory for both stable and
    // volatile pools (the factory stores pools in a
    // mapping(tokenA => mapping(tokenB => mapping(bool stable => address)))).
    // The published address on Base is 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
    // (verified live: Aerodrome Router's defaultFactory() returns this value).
    address constant DEFAULT_AERODROME_VOLATILE_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address constant DEFAULT_AERODROME_STABLE_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    // The canonical feeRecipient, deployer — same as the other P4.1 wrappers.
    address constant DEFAULT_FEE_RECIPIENT = 0x3f44A6451439673D95082A1337045a25ec275394;
    uint256 constant BASE_CHAIN_ID = 8453;

    function run() external {
        address aerodromeRouter = vm.envOr("AERODROME_ROUTER", DEFAULT_AERODROME_ROUTER);
        address weth = vm.envOr("WETH", DEFAULT_WETH);
        address volatileFactory = vm.envOr("AERODROME_VOLATILE_FACTORY", DEFAULT_AERODROME_VOLATILE_FACTORY);
        address stableFactory = vm.envOr("AERODROME_STABLE_FACTORY", DEFAULT_AERODROME_STABLE_FACTORY);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT"); // required (IMMUTABLE)
        require(feeRecipient != address(0), "FEE_RECIPIENT must not be zero (IMMUTABLE)");

        address deployer = msg.sender;
        console2.log("=== UPL - Deploy AerodromePrivacyWrapper on Base ===");
        console2.log("Deployer:", deployer);
        console2.log("AerodromeRouter:", aerodromeRouter);
        console2.log("WETH:", weth);
        console2.log("Volatile factory:", volatileFactory);
        console2.log("Stable factory:  ", stableFactory);
        console2.log("feeRecipient (IMMUTABLE):", feeRecipient);

        vm.startBroadcast();
        AerodromePrivacyWrapper aeroWrapper =
            new AerodromePrivacyWrapper(aerodromeRouter, weth, feeRecipient, volatileFactory, stableFactory);
        vm.stopBroadcast();

        console2.log("AerodromePrivacyWrapper deployed:", address(aeroWrapper));
        console2.log("  aerodromeRouter():", aeroWrapper.aerodromeRouter());
        console2.log("  WETH():", aeroWrapper.WETH());
        console2.log("  volatileFactory():", aeroWrapper.volatileFactory());
        console2.log("  stableFactory():", aeroWrapper.stableFactory());
        console2.log("  feeRecipient():", aeroWrapper.feeRecipient());
        console2.log("=== Done. Add this address to deployed_base.json manually. ===");
    }
}
