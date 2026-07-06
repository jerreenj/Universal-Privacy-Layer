// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {StealthAddressRegistry} from "../src/StealthAddressRegistry.sol";
import {PrivacyRelayer} from "../src/PrivacyRelayer.sol";
import {UniswapPrivacyWrapper} from "../src/UniswapPrivacyWrapper.sol";
import {AerodromePrivacyWrapper} from "../src/AerodromePrivacyWrapper.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";

/// @notice Deploy script for the UPL EVM contracts on Base mainnet.
///
/// @dev P1.6 deployed the first three contracts (registry, relayer, wrapper).
///      P3.4 extended this to also deploy the ZK privacy pool stack (verifier +
///      single-denom pool). P4.1 multi-denominates the pool: the constructor
///      now takes `(verifier, initialDenominations[])` and the owner can call
///      `addDenomination()` post-deploy to register more fixed denominations.
///        4. Groth16Verifier  — the snarkjs-generated verifier (zero args).
///        5. PrivacyPool      — incremental Poseidon Merkle pool, MULTI-DENOM
///                              (P4.1). Takes the verifier + the initial
///                              denominations array. PoseidonT3 is a linked
///                              library that Foundry deploys + links
///                              automatically under `forge script --broadcast`.
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
///   PrivacyPool (P4.1)      — 2 args: verifier (Groth16Verifier, immutable),
///                             initialDenominations (uint256[] — wei amounts
///                             for each fixed-face-value pool, e.g.
///                             [0.01 ether, 0.1 ether, 1 ether]). The owner
///                             can `addDenomination(d)` post-deploy to add
///                             more; the global nullifierHashes spent set
///                             then protects ALL of them. Backwards
///                             compatible with P3: pass `[POOL_DENOMINATION_WEI]`
///                             as a 1-element array to recover the exact
///                             pre-P4.1 pool state.
contract DeployScript is Script {
    // ── Base mainnet defaults (overridable via env) ─────────────────────────
    /// @dev Canonical Uniswap V3 SwapRouter — NOT SwapRouter02. The contract's
    ///      ISwapRouter.ExactInputSingleParams has a `deadline` field that only
    ///      the original V3 SwapRouter matches; SwapRouter02 omits it. Same
    ///      address on all Uniswap-deployed chains including Base.
    address constant DEFAULT_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    /// @dev Base WETH9 — 0x420…0006, the canonical WETH on all OP-stack L2s.
    address constant DEFAULT_WETH = 0x4200000000000000000000000000000000000006;

    /// @dev Aerodrome V2 Router — Base mainnet production router.
    /// P4.2: Uniswap V3 has no/limited WETH/USDC liquidity on Base; Aerodrome
    /// is the primary DEX. The frontend will route to whichever wrapper
    /// the user picked; the Aerodrome wrapper supports ETH<->Token swaps
    /// through Aerodrome's stable/volatile pool types (instead of the
    /// single-v3-pool-fee-tier model). The same constants are shared
    /// across wrappers, so the user can swap WETH<->USDC through either
    /// DEX without redeploying.
    address constant DEFAULT_AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    /// @dev Aerodrome V2 PoolFactory on Base — used for both stable and
    ///      volatile pool creations. Verified live by reading Aerodrome
    ///      Router.defaultFactory() = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
    ///      on Base mainnet (the Router treats this as the default —
    ///      Aerodrome's PoolFactory.sol stores pools in
    ///      mapping(tokenA=>mapping(tokenB=>mapping(bool stable=>address)))),
    ///      so a single factory handles both pool kinds. The wrapper
    ///      takes both addresses as constructor args; if Aerodrome ever
    ///      splits them we can override AERODROME_STABLE_FACTORY at deploy
    ///      time.
    address constant DEFAULT_AERODROME_VOLATILE_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address constant DEFAULT_AERODROME_STABLE_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    /// @dev Default privacy-pool denomination seed: 0.1 ETH (1e17 wei). Fixed
    ///      denominations are what make deposits unlinkable — every 0.1 ETH
    ///      deposit is indistinguishable from any other. With P4.1 multi-denom
    ///      this is just the SEED amount; the owner can call
    ///      `pool.addDenomination(...)` post-deploy to register more
    ///      (e.g. 0.01 ETH, 1 ETH, 10 ETH). Override at deploy time via
    ///      POOL_DENOMINATION_WEI for a different initial face value.
    uint256 constant DEFAULT_POOL_DENOMINATION = 0.1 ether;

    /// @dev P4.1 also lifts a multi-denom seed list. Comma-separated denoms in
    ///      POOL_DENOMINATIONS_WEI override the single POOL_DENOMINATION_WEI.
    ///      e.g.  `POOL_DENOMINATIONS_WEI=10000000000000000,100000000000000000,1000000000000000000`
    ///      seeds the pool with 0.01 / 0.1 / 1 ETH face values at deploy time.
    string constant DEFAULT_DENOMS_ENV_KEY = "POOL_DENOMINATIONS_WEI";
    string constant SINGLE_DENOM_ENV_KEY = "POOL_DENOMINATION_WEI";

    uint256 constant BASE_CHAIN_ID = 8453;

    function run() external {
        // ── Read constructor args from env (with Base mainnet defaults) ──────
        address swapRouter = vm.envOr("SWAP_ROUTER", DEFAULT_SWAP_ROUTER);
        address weth = vm.envOr("WETH", DEFAULT_WETH);
        // FEE_RECIPIENT is required — it is immutable after deploy (no setter).
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        require(feeRecipient != address(0), "FEE_RECIPIENT must not be the zero address");

        // Build the initial denominations array. Precedence: POOL_DENOMINATIONS_WEI
        // (comma-separated multi-denom, P4.1) over POOL_DENOMINATION_WEI (single,
        // back-compat). If neither is set we fall back to [DEFAULT_POOL_DENOMINATION].
        uint256[] memory initialDenominations = _readInitialDenominations();

        address deployer = msg.sender;
        console2.log("=== UPL Deploy - Base Mainnet (chainId 8453) ===");
        console2.log("Deployer (owner + relayer):", deployer);
        console2.log("SwapRouter:", swapRouter);
        console2.log("WETH:", weth);
        console2.log("FeeRecipient (IMMUTABLE):", feeRecipient);
        console2.log("Initial denominations seeded:", initialDenominations.length);
        for (uint256 i = 0; i < initialDenominations.length; i++) {
            console2.log("    denom[i] (wei):", initialDenominations[i]);
        }
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

        // 3b. AerodromePrivacyWrapper (P4.2) — runs in parallel to the
        //     Uniswap wrapper. Same shape + fee model, but uses Aerodrome's
        //     Router (which is Base's primary DEX; Uniswap V3 has no
        //     WETH/USDC pool on Base per the P1.13 finding). The frontend
        //     dispatches per selected chain / per preferred DEX.
        address aerodromeRouter = vm.envOr("AERODROME_ROUTER", DEFAULT_AERODROME_ROUTER);
        address aerodromeVolatileFactory = vm.envOr("AERODROME_VOLATILE_FACTORY", DEFAULT_AERODROME_VOLATILE_FACTORY);
        address aerodromeStableFactory = vm.envOr("AERODROME_STABLE_FACTORY", DEFAULT_AERODROME_STABLE_FACTORY);
        AerodromePrivacyWrapper aeroWrapper = new AerodromePrivacyWrapper(
            aerodromeRouter, weth, feeRecipient, aerodromeVolatileFactory, aerodromeStableFactory
        );
        console2.log("AerodromePrivacyWrapper deployed:", address(aeroWrapper));
        console2.log("  aerodromeRouter:", aeroWrapper.aerodromeRouter());
        console2.log("  WETH:", aeroWrapper.WETH());
        console2.log("  feeRecipient:", aeroWrapper.feeRecipient());

        // 4. Groth16Verifier (P3.4) — the snarkjs-generated verifier for
        //    withdraw.circom. Zero args. Public-signal order
        //    [nullifierHash, root, recipient] is baked into the generated code.
        Groth16Verifier verifier = new Groth16Verifier();
        console2.log("Groth16Verifier deployed:", address(verifier));

        // 5. PrivacyPool (P4.1) — multi-denom incremental Poseidon Merkle pool.
        //    Constructor signs in the verifier + the seed denomination list;
        //    the owner can call `addDenomination(...)` post-deploy to add more.
        //    PoseidonT3 is a linked library — Foundry deploys + links it
        //    automatically under `forge script --broadcast` (no manual link).
        PrivacyPool pool = new PrivacyPool(address(verifier), initialDenominations);
        console2.log("PrivacyPool deployed:", address(pool));
        console2.log("  verifier:", address(pool.verifier()));
        uint256[] memory seeded = pool.getDenominationList();
        console2.log("  seeded denominations:");
        for (uint256 i = 0; i < seeded.length; i++) {
            console2.log("    seeded[i] (wei):", seeded[i]);
        }

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
        baseObj = vm.serializeAddress(baseObj, "aerodrome_wrapper", address(aeroWrapper));
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

    /// @dev Resolve the seed denomination list for the pool constructor. Reads
    ///      POOL_DENOMINATIONS_WEI (comma-separated uint256 wei amounts) if
    ///      present, else falls back to [POOL_DENOMINATION_WEI] (single back-
    ///      compat), else to [DEFAULT_POOL_DENOMINATION].
    function _readInitialDenominations() internal view returns (uint256[] memory denoms) {
        // Try multi-denom first (presence check via envOr + empty-string
        // pattern). vm.envOr returns the default when the env var is unset.
        // We deliberately test a zero-string sentinel so unset == "" default.
        string memory multi = vm.envOr(DEFAULT_DENOMS_ENV_KEY, string(""));
        bytes memory b = bytes(multi);
        if (b.length > 0) {
            denoms = _parseDenominationsCsv(multi);
            require(denoms.length > 0, "POOL_DENOMINATIONS_WEI parsed empty");
            return denoms;
        }
        // Back-compat: single denom env.
        denoms = new uint256[](1);
        denoms[0] = vm.envOr(SINGLE_DENOM_ENV_KEY, DEFAULT_POOL_DENOMINATION);
        require(denoms[0] > 0, "POOL_DENOMINATION_WEI must be > 0");
        return denoms;
    }

    /// @dev Parse a comma-separated decimal uint256 string into an array.
    ///      Tolerates whitespace around commas. Caps at 16 initial denoms
    ///      so we never blow the constructor memory limit; more denominations
    ///      can always be added post-deploy via addDenomination().
    function _parseDenominationsCsv(string memory csv) internal pure returns (uint256[] memory out) {
        bytes memory b = bytes(csv);
        // Count commas for allocation.
        uint256 count = 1;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ",") count++;
        }
        if (count > 16) count = 16;
        out = new uint256[](count);

        uint256 idx = 0;
        uint256 start = 0;
        uint256 accum;
        uint256 written = 0;
        bool inNum = false;
        for (uint256 i = 0; i <= b.length; i++) {
            bytes1 c = i < b.length ? b[i] : bytes1(","); // sentinel
            if (c == "," || i == b.length) {
                if (inNum && written < out.length) {
                    out[written++] = accum;
                }
                idx = 0;
                accum = 0;
                inNum = false;
                continue;
            }
            if (c == " " || c == "\t" || c == "\n") continue;
            // ASCII decimal digit.
            uint8 d = uint8(c) - uint8(bytes1("0"));
            require(d < 10, "invalid digit in denomination csv");
            accum = accum * 10 + d;
            inNum = true;
        }
        // Trim trailing zeros if parse halted early.
        if (written < count) {
            assembly {
                mstore(out, written)
            }
        }
    }
}
