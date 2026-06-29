// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {StealthAddressRegistry} from "../src/StealthAddressRegistry.sol";
import {PrivacyRelayer} from "../src/PrivacyRelayer.sol";
import {UniswapPrivacyWrapper} from "../src/UniswapPrivacyWrapper.sol";

/// @notice P1.6 deploy script — deploys all three UPL EVM contracts to Base mainnet.
///
/// @dev Run via scripts/deploy_base.sh, which wraps:
///
///   forge script script/Deploy.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
///
/// The script writes contracts/deployed_base.json (addresses + chainId).
/// deploy_base.sh enriches it with deployedAt + commit provenance via an
/// inline python step (those values are not available inside the EVM).
///
/// Constructor arg sources:
///   StealthAddressRegistry  — zero args, no owner, permissionless mailbox.
///   PrivacyRelayer          — zero args; deployer becomes owner AND relayer
///                             (rotate via setRelayer() post-deploy if a
///                             dedicated relayer hot-wallet exists).
///   UniswapPrivacyWrapper   — 3 args: swapRouter, WETH, feeRecipient.
///                             swapRouter + WETH are immutable; feeRecipient
///                             is immutable (NO setter) — choose carefully.
contract DeployScript is Script {
    // ── Base mainnet defaults (overridable via env) ─────────────────────────
    /// @dev Canonical Uniswap V3 SwapRouter — NOT SwapRouter02. The contract's
    ///      ISwapRouter.ExactInputSingleParams has a `deadline` field that only
    ///      the original V3 SwapRouter matches; SwapRouter02 omits it. Same
    ///      address on all Uniswap-deployed chains including Base.
    address constant DEFAULT_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    /// @dev Base WETH9 — 0x420…0006, the canonical WETH on all OP-stack L2s.
    address constant DEFAULT_WETH = 0x4200000000000000000000000000000000000006;

    uint256 constant BASE_CHAIN_ID = 8453;

    function run() external {
        // ── Read constructor args from env (with Base mainnet defaults) ──────
        address swapRouter = vm.envOr("SWAP_ROUTER", DEFAULT_SWAP_ROUTER);
        address weth = vm.envOr("WETH", DEFAULT_WETH);
        // FEE_RECIPIENT is required — it is immutable after deploy (no setter).
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        require(feeRecipient != address(0), "FEE_RECIPIENT must not be the zero address");

        address deployer = msg.sender;
        console2.log("=== UPL P1.6 Deploy - Base Mainnet (chainId 8453) ===");
        console2.log("Deployer (owner + relayer):", deployer);
        console2.log("SwapRouter:", swapRouter);
        console2.log("WETH:", weth);
        console2.log("FeeRecipient (IMMUTABLE):", feeRecipient);
        console2.log("");

        vm.startBroadcast();

        // 1. StealthAddressRegistry — zero args, no owner, permissionless.
        StealthAddressRegistry registry = new StealthAddressRegistry();
        console2.log("StealthAddressRegistry deployed:", address(registry));

        // 2. PrivacyRelayer — zero args; deployer becomes owner + relayer.
        PrivacyRelayer relayer = new PrivacyRelayer();
        console2.log("PrivacyRelayer deployed:", address(relayer));
        console2.log("  owner:", relayer.owner());
        console2.log("  relayer:", relayer.relayer());

        // 3. UniswapPrivacyWrapper — 3 immutable args.
        UniswapPrivacyWrapper wrapper = new UniswapPrivacyWrapper(swapRouter, weth, feeRecipient);
        console2.log("UniswapPrivacyWrapper deployed:", address(wrapper));
        console2.log("  swapRouter:", wrapper.swapRouter());
        console2.log("  WETH:", wrapper.WETH());
        console2.log("  feeRecipient:", wrapper.feeRecipient());

        vm.stopBroadcast();

        // ── Write deployed_base.json (addresses + chainId) ───────────────────
        // The backend's _load_deployed_addresses() iterates the top-level keys
        // as chain names and expects each value to be a dict of address fields.
        // So the manifest must be {"base": {...}}, not a flat object. Foundry's
        // vm.serialize* with the same objectKey accumulates into one nested object.
        string memory baseObj = "base";
        baseObj = vm.serializeAddress(baseObj, "privacy_relayer", address(relayer));
        baseObj = vm.serializeAddress(baseObj, "stealth_registry", address(registry));
        baseObj = vm.serializeAddress(baseObj, "uniswap_wrapper", address(wrapper));
        baseObj = vm.serializeUint(baseObj, "chainId", BASE_CHAIN_ID);
        string memory json = "deployed_base";
        json = vm.serializeString(json, "base", baseObj);
        vm.writeJson(json, "deployed_base.json");

        console2.log("");
        console2.log("deployed_base.json written to contracts/deployed_base.json");
        console2.log("=== Deploy complete. Run deploy_base.sh for provenance + verify. ===");
    }
}
