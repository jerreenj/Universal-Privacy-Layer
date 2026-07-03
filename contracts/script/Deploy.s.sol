// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {StealthAddressRegistry} from "../src/StealthAddressRegistry.sol";
import {PrivacyRelayer} from "../src/PrivacyRelayer.sol";
import {UniswapPrivacyWrapper} from "../src/UniswapPrivacyWrapper.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";

/// @notice Deploy script for the UPL EVM contracts on Base mainnet.
///
/// @dev P1.6 deployed the first three contracts (registry, relayer, wrapper).
///      P3.4 extends this to also deploy the ZK privacy pool stack:
///        4. Groth16Verifier  — the snarkjs-generated verifier (zero args).
///        5. PrivacyPool      — incremental Poseidon Merkle pool; takes the
///                              fixed deposit denomination (wei) + the verifier
///                              address. PoseidonT3 is a linked library that
///                              Foundry deploys + links automatically under
///                              `forge script --broadcast`.
///
/// Run via scripts/deploy_base.sh, which wraps:
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
///   Groth16Verifier         — zero args; the snarkjs-generated verifier for
///                             withdraw.circom (public signals
///                             [nullifierHash, root, recipient]).
///   PrivacyPool             — 2 args: denomination (wei, immutable — fixed
///                             denominations are what make pools anonymous),
///                             verifier (the Groth16Verifier address, immutable).
///                             Defaults to 0.1 ETH; override via
///                             POOL_DENOMINATION_WEI for a different face value.
contract DeployScript is Script {
    // ── Base mainnet defaults (overridable via env) ─────────────────────────
    /// @dev Canonical Uniswap V3 SwapRouter — NOT SwapRouter02. The contract's
    ///      ISwapRouter.ExactInputSingleParams has a `deadline` field that only
    ///      the original V3 SwapRouter matches; SwapRouter02 omits it. Same
    ///      address on all Uniswap-deployed chains including Base.
    address constant DEFAULT_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    /// @dev Base WETH9 — 0x420…0006, the canonical WETH on all OP-stack L2s.
    address constant DEFAULT_WETH = 0x4200000000000000000000000000000000000006;

    /// @dev Default privacy-pool denomination: 0.1 ETH (1e17 wei). Fixed
    ///      denominations are what make deposits unlinkable — every 0.1 ETH
    ///      deposit is indistinguishable from any other. Override at deploy
    ///      time via POOL_DENOMINATION_WEI for a different face value. This is
    ///      IMMUTABLE on the deployed PrivacyPool (no setter) — like
    ///      feeRecipient, a wrong value means a costly redeploy.
    uint256 constant DEFAULT_POOL_DENOMINATION = 0.1 ether;

    uint256 constant BASE_CHAIN_ID = 8453;

    function run() external {
        // ── Read constructor args from env (with Base mainnet defaults) ──────
        address swapRouter = vm.envOr("SWAP_ROUTER", DEFAULT_SWAP_ROUTER);
        address weth = vm.envOr("WETH", DEFAULT_WETH);
        // FEE_RECIPIENT is required — it is immutable after deploy (no setter).
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        require(feeRecipient != address(0), "FEE_RECIPIENT must not be the zero address");
        // Pool denomination defaults to 0.1 ETH; override for a different
        // face value. Immutable post-deploy (no setter on PrivacyPool).
        uint256 poolDenomination = vm.envOr("POOL_DENOMINATION_WEI", DEFAULT_POOL_DENOMINATION);
        require(poolDenomination > 0, "POOL_DENOMINATION_WEI must be > 0");

        address deployer = msg.sender;
        console2.log("=== UPL Deploy - Base Mainnet (chainId 8453) ===");
        console2.log("Deployer (owner + relayer):", deployer);
        console2.log("SwapRouter:", swapRouter);
        console2.log("WETH:", weth);
        console2.log("FeeRecipient (IMMUTABLE):", feeRecipient);
        console2.log("Pool denomination (IMMUTABLE):", poolDenomination, "wei");
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

        // 4. Groth16Verifier (P3.4) — the snarkjs-generated verifier for
        //    withdraw.circom. Zero args. Public-signal order
        //    [nullifierHash, root, recipient] is baked into the generated code.
        Groth16Verifier verifier = new Groth16Verifier();
        console2.log("Groth16Verifier deployed:", address(verifier));

        // 5. PrivacyPool (P3.4) — incremental Poseidon Merkle pool. Takes the
        //    fixed denomination (wei) + the verifier address; both immutable.
        //    PoseidonT3 is a linked library — Foundry deploys + links it
        //    automatically under `forge script --broadcast` (no manual link).
        PrivacyPool pool = new PrivacyPool(poolDenomination, address(verifier));
        console2.log("PrivacyPool deployed:", address(pool));
        console2.log("  denomination:", pool.denomination(), "wei");
        console2.log("  verifier:", address(pool.verifier()));

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
        baseObj = vm.serializeAddress(baseObj, "privacy_verifier", address(verifier));
        baseObj = vm.serializeAddress(baseObj, "privacy_pool", address(pool));
        baseObj = vm.serializeUint(baseObj, "chainId", BASE_CHAIN_ID);
        string memory json = "deployed_base";
        json = vm.serializeString(json, "base", baseObj);
        vm.writeJson(json, "deployed_base.json");

        console2.log("");
        console2.log("deployed_base.json written to contracts/deployed_base.json");
        console2.log("=== Deploy complete. Run deploy_base.sh for provenance + verify. ===");
    }
}
