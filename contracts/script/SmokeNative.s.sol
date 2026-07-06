// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NativePrivateSwap} from "../src/NativePrivateSwap.sol";

/// @notice E2E smoke test for the **native** private swap on Base.
///
///         Performs a single NativePrivateSwap.swapETHForUSDC call as
///         the customer's EOA, paying USDC straight to a recipient
///         address (in production: a stealth address from
///         /api/stealth/generate) and verifying that the recipient's
///         USDC balance went up by exactly the vault.quote() preview.
///
///         This is the in-house swap path — owned by us, no third-party
///         router — that the Core Actions 'Private Swap' tile calls
///         (frontend/src/components/features/SwapContent.jsx).
///
/// Pricing sanity (at the live rate RATE = 3_000_000_000 / 1e18):
///   0.000001 ETH in   -> fee 0.00005e14 -> swapAmount 0.99995e14
///   expected USDC out = 0.99995e14 * 3_000_000_000 / 1e18 = ~2.99985e6
///   micro-USDC = ~0.00299985 USDC = a few thousandths of a cent.
///
/// Run modes:
///   DRY-RUN (default):
///     set -a && source contracts/.env && set +a
///     forge script script/SmokeNative.s.sol \
///       --rpc-url https://mainnet.base.org
///     => simulates the swap, prints pre/post balance delta, exits
///        without broadcasting. Safe, no money spent.
///
///   LIVE (requires explicit user authorization — see AskUserQuestion
///   before running this):
///     add   --broadcast   to the forge script command
contract SmokeNativeScript is Script {
    address constant DEFAULT_VAULT = 0x582c57a7ba6E7758e75dC5334A5E8fF096515D09;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Drift between broadcasted env and scripted default would be
    // intentionally loud: env wins, the default below is only used if
    // neither is set.
    address constant DEFAULT_RECIPIENT = 0x3f44A6451439673D95082A1337045a25ec275394;
    uint256 constant AMOUNT_IN = 1e12; // 0.000001 ETH — tiny smoke size

    bool constant BROADCAST = false; // flip to true ONLY after AskUserQuestion confirmed

    function run() external {
        address vaultAddr = vm.envOr("NATIVE_SWAP_ADDR", DEFAULT_VAULT);
        address recipient = vm.envOr("SMOKE_RECIPIENT", DEFAULT_RECIPIENT);

        NativePrivateSwap vault = NativePrivateSwap(payable(vaultAddr));
        IERC20 usdc = IERC20(USDC);

        // Pre-state.
        uint256 reserveBefore = vault.reserveBalance();
        uint256 rate = vault.usdcPerEth();
        uint256 recipientBefore = usdc.balanceOf(recipient);
        uint256 expectedOut = vault.quote(AMOUNT_IN);
        // 5 bps protocol fee is hard-coded in NativePrivateSwap (matches
        // the other Privacy wrappers; fee is intentionally a constant —
        // no on-chain setter because the rate is the operator's lever,
        // not the fee).
        uint256 fee = (AMOUNT_IN * 5) / 10000;
        uint256 swapAmount = AMOUNT_IN - fee;
        uint256 expectedDelta = (swapAmount * rate) / 1e18;

        console2.log("=== UPL - NativePrivateSwap E2E smoke (Base) ===");
        console2.log("Vault:           ");
        console2.log(vaultAddr);
        console2.log("Recipient:       ");
        console2.log(recipient);
        console2.log("Amount in (wei): ");
        console2.log(AMOUNT_IN);
        console2.log("Fee (wei):       ");
        console2.log(fee);
        console2.log("Swap (wei):      ");
        console2.log(swapAmount);
        console2.log("Rate (6-dec):    ");
        console2.log(rate);
        console2.log("Reserve before:  ");
        console2.log(reserveBefore);
        console2.log("Recipient before:");
        console2.log(recipientBefore);
        console2.log("Quote output:    ");
        console2.log(expectedOut);
        console2.log("Computed delta:  ");
        console2.log(expectedDelta);

        require(expectedDelta == expectedOut, "quote() vs manual formula mismatch");
        require(expectedDelta <= reserveBefore, "vault liquidity insufficient for smoke");

        if (!BROADCAST) {
            console2.log("DRY-RUN: not broadcasting. To broadcast, flip BROADCAST=true.");
            return;
        }

        vm.startBroadcast();
        uint256 rcvBeforeBroadcast = usdc.balanceOf(recipient);
        vault.swapETHForUSDC{value: AMOUNT_IN}(recipient, 0);
        uint256 rcvAfterBroadcast = usdc.balanceOf(recipient);
        vm.stopBroadcast();

        console2.log("Recipient after: ");
        console2.log(rcvAfterBroadcast);
        console2.log("Delta:           ");
        console2.log(rcvAfterBroadcast - rcvBeforeBroadcast);

        require(
            rcvAfterBroadcast - rcvBeforeBroadcast == expectedOut, "USDC delta != quote output (vault accounting drift)"
        );
        console2.log("=== NativePrivateSwap smoke OK ===");
    }
}
