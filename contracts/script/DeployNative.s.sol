// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NativePrivateSwap} from "../src/NativePrivateSwap.sol";

/// @notice Broadcasts NativePrivateSwap to Base mainnet.
///
///         One-shot tool that ALSO funds the contract with a small
///         USDC reserve so the customer pilot has the liquidity to
///         perform the first round of pilot swaps without an extra
///         funding round-trip. The reserve size is `NATIVE_SEED_USDC`
///         (6-decimal USDC units, default 0.5 USDC = 500_000).
///
///         Flow:
///           1. compile + dry-run gate
///           2. CREATE NativePrivateSwap (USDC + feeRecipient + rate + owner)
///           3. ERC20.approve(NativePrivateSwap, seed)
///           4. NativePrivateSwap.fundUSDC(seed) — server feeds reserves
///           5. Optional smoke call: NativePrivateSwap.quote(0.001 ether)
///              reads back to confirm the rate + formula are right
///           6. emit {address, address(NativePrivateSwap), seeded_balance}
///              so the post-deploy helper script can splice the
///              address into contracts/deployed_base.json.
///
///         Run via:
///         DEPLOYER_PRIVATE_KEY=0x... \
///         FEE_RECIPIENT=0x3f44...         \
///         forge script script/DeployNative.s.sol \
///           --rpc-url https://mainnet.base.org --broadcast
///
///         Env vars:
///           BASE_RPC_URL        (default https://mainnet.base.org)
///           DEPLOYER_PRIVATE_KEY        (required)
///           FEE_RECIPIENT              (required)
///           NATIVE_USDC_ADDRESS        (default 0x833589..02913 = canonical Base USDC)
///           NATIVE_SWAP_RATE_PER_ETH   (default 3000 USDC/ETH = 3000_000000 6-dec units)
///           NATIVE_SEED_USDC           (default 500_000 = 0.5 USDC)
///
///         The owner is the deployer; rate + feeRecipient are
///         rotatable post-deploy via setRate / setFeeRecipient so
///         the ops wallet can keep control without re-broadcasting.
contract DeployNativeScript is Script {
    address constant DEFAULT_USDC        = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant DEFAULT_RATE_PER_ETH = 3_000_000_000;   // 3000 USDC / ETH
    uint256 constant DEFAULT_SEED_USDC    = 500_000;         // 0.5 USDC

    function run() external {
        address usdc        = vm.envOr("NATIVE_USDC_ADDRESS", DEFAULT_USDC);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 rate        = vm.envOr("NATIVE_SWAP_RATE_PER_ETH", DEFAULT_RATE_PER_ETH);
        uint256 seed        = vm.envOr("NATIVE_SEED_USDC", DEFAULT_SEED_USDC);
        require(feeRecipient != address(0),        "FEE_RECIPIENT required");
        require(rate > 0,                          "rate must be > 0");
        require(seed > 0,                          "seed must be > 0");

        address deployer = msg.sender;
        console2.log("=== UPL - Deploy NativePrivateSwap on Base ===");
        console2.log("Deployer:       ", deployer);
        console2.log("USDC:           ", usdc);
        console2.log("Fee recipient:  ", feeRecipient);
        console2.log("Rate (per ETH): ", rate);
        console2.log("Seed USDC:      ", seed);

        vm.startBroadcast();
        NativePrivateSwap vault = new NativePrivateSwap(usdc, feeRecipient, rate, deployer);

        // Seed reserves from the deployer wallet. If the deployer has
        // 0 USDC the ERC20 transferFrom below reverts — surfaced as
        // a clean pre-deploy check below in the post-deploy script.
        IERC20(usdc).approve(address(vault), seed);
        vault.fundUSDC(seed);

        // Smoke check — quote() is a view so it costs zero gas, but
        // reads the on-chain storage to confirm the rate landed
        // intact through the CREATE call.
        uint256 previewUsdc = vault.quote(0.001 ether);
        vm.stopBroadcast();

        console2.log("NativePrivateSwap deployed at:", address(vault));
        console2.log("  usdc():              ", vault.USDC());
        console2.log("  feeRecipient():      ", vault.feeRecipient());
        console2.log("  usdcPerEth():        ", vault.usdcPerEth());
        console2.log("  reserveBalance():    ", vault.reserveBalance());
        console2.log("  quote(0.001 ether):  ", previewUsdc, "usdc units");

        // Single-line emitter for the post-deploy manifest writer.
        console2.log("UPL_NATIVE_SWAP_ADDR=", address(vault));
        console2.log("UPL_NATIVE_SWAP_RATE=", vault.usdcPerEth());
        console2.log("UPL_NATIVE_SWAP_SEED=", vault.reserveBalance());
        console2.log("=== Done. Update contracts/deployed_base.json with native_swap_wrapper. ===");
    }
}
