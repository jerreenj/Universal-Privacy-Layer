// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/ConfidentialNativePrivateSwap.sol";

/**
 * @notice ONE-OFF broadcast for ConfidentialNativePrivateSwap on Base.
 *         Mirrors DeployNative.s.sol's broadcast pattern but
 *         also seeds the vault with a small USDC reserve so the
 *         customer demo can use it immediately.
 *
 * Default secrets:
 *   USDC_BASE = the canonical Base USDC at 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   RATE_PER_ETH = 1_700_000_000 (= 1700 USDC/ETH in 6-decimal USDC units)
 *   SEED_USDC = 2_000_000 (2.0 USDC of liquidity so the demo customer's
 *               first few swaps don't hit InsufficientReserves)
 *
 * All defaults override via env:
 *   CONFIDENTIAL_USDC_ADDRESS         - alternative stable token
 *   FEE_RECIPIENT                     - protocol fee recipient (deployer by default)
 *   CONFIDENTIAL_RATE_PER_ETH         - microUSDC-per-wei rate (default 1_700_000_000)
 *   CONFIDENTIAL_SEED_USDC            - 6-decimal USDC units to fund at deploy (default 2_000_000)
 */
contract DeployConfidentialScript is Script {
    address constant DEFAULT_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant DEFAULT_RATE = 1_700_000_000; // 1700 USDC/ETH
    uint256 constant DEFAULT_SEED = 0; // skip seed at deploy; fund separately

    function run() external {
        address usdc = vm.envOr("CONFIDENTIAL_USDC_ADDRESS", DEFAULT_USDC);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 rate = vm.envOr("CONFIDENTIAL_RATE_PER_ETH", DEFAULT_RATE);
        uint256 seed = vm.envOr("CONFIDENTIAL_SEED_USDC", DEFAULT_SEED);
        require(feeRecipient != address(0), "FEE_RECIPIENT required");
        require(rate > 0, "rate=0");

        address deployer = msg.sender;
        console2.log("=== UPL - Deploy ConfidentialNativePrivateSwap on Base ===");
        console2.log("USDC:");
        console2.log(usdc);
        console2.log("Fee:");
        console2.log(feeRecipient);
        console2.log("Rate (6dec):");
        console2.log(rate);
        if (seed > 0) {
            console2.log("Seed (6dec):");
            console2.log(seed);
        }

        vm.startBroadcast();
        ConfidentialNativePrivateSwap v = new ConfidentialNativePrivateSwap(usdc, feeRecipient, rate, deployer);

        // Seed reserves — only if explicitly requested via env. Default
        // off so a missing deployer USDC balance can't roll back the
        // contract creation. Operator funds separately via cast send.
        if (seed > 0) {
            IERC20Like(usdc).approve(address(v), seed);
            v.fundUSDC(seed);
        }
        vm.stopBroadcast();

        console2.log("Deployed:");
        console2.log(address(v));
        if (seed > 0) {
            console2.log("Reserve after seed (6dec):");
            console2.log(IERC20Like(usdc).balanceOf(address(v)));
        } else {
            console2.log("Reserve: 0 (fund separately via fundUSDC)");
        }

        console2.log("UPL_CONFIDENTIAL_SWAP_ADDR=");
        console2.log(address(v));
        console2.log("Note: SwapConfidentialExecuted emits bytes32 usdcAmountCommitment");
        console2.log("INSTEAD OF plaintext amt. msg.value (ETH input) still visible.");
        console2.log("Update contracts/deployed_base.json with this address.");
    }
}

interface IERC20Like {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
