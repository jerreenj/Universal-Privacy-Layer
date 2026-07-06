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
contract DeployNativeScript is Script {
    address constant DEFAULT_USDC        = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant DEFAULT_RATE_PER_ETH = 3_000_000_000;   // 3000 USDC / ETH
    uint256 constant DEFAULT_SEED_USDC    = 500_000;         // 0.5 USDC

    function run() external {
        address usdc        = vm.envOr("NATIVE_USDC_ADDRESS",          DEFAULT_USDC);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 rate        = vm.envOr("NATIVE_SWAP_RATE_PER_ETH",    DEFAULT_RATE_PER_ETH);
        uint256 seed        = vm.envOr("NATIVE_SEED_USDC",            DEFAULT_SEED_USDC);
        require(feeRecipient != address(0), "FEE_RECIPIENT required");
        require(rate > 0,                   "rate must be > 0");
        require(seed > 0,                   "seed must be > 0");

        address deployer = msg.sender;
        console2.log("=== UPL - Deploy NativePrivateSwap on Base ===");
        console2.log("Deployer:    ");
        console2.log(deployer);
        console2.log("USDC:        ");
        console2.log(usdc);
        console2.log("Fee:         ");
        console2.log(feeRecipient);
        console2.log("Rate (6dec): ");
        console2.log(rate);
        console2.log("Seed (6dec): ");
        console2.log(seed);

        vm.startBroadcast();
        NativePrivateSwap vault = new NativePrivateSwap(usdc, feeRecipient, rate, deployer);

        // Seed reserves. If the deployer has 0 USDC, transferFrom
        // reverts cleanly so the broadcast aborts before charging
        // CREATE gas only to render swap-inert.
        IERC20(usdc).approve(address(vault), seed);
        vault.fundUSDC(seed);

        // Read back on-chain state before stopping the broadcast.
        address v         = address(vault);
        address u         = address(vault.USDC());
        address fr        = vault.feeRecipient();
        uint256 r         = vault.usdcPerEth();
        uint256 reserve   = vault.reserveBalance();
        uint256 previewUsdc = vault.quote(0.001 ether);
        vm.stopBroadcast();

        console2.log("Deployed:     ");
        console2.log(v);
        console2.log("  usdc:        ");
        console2.log(u);
        console2.log("  fee:         ");
        console2.log(fr);
        console2.log("  rate(6dec):  ");
        console2.log(r);
        console2.log("  reserve:     ");
        console2.log(reserve);
        console2.log("  quote(e001): ");
        console2.log(previewUsdc);

        console2.log("UPL_NATIVE_SWAP_ADDR=");
        console2.log(v);
        console2.log("UPL_NATIVE_SWAP_RATE=");
        console2.log(r);
        console2.log("UPL_NATIVE_SWAP_SEED=");
        console2.log(reserve);
        console2.log("=== Done. Update contracts/deployed_base.json ===");
    }
}
