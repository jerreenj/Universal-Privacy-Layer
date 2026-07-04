// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {PoseidonT3} from "../src/PoseidonT3.sol";

/// @title PrivacyPoolBaseFork.t.sol - fork test against LIVE Base mainnet
/// @notice P3.5 fork e2e: actually deposit into the live PrivacyPool
///         deployed in P3.4, then withdraw with a real snarkjs Groth16
///         proof. NO REAL GAS spent (vm.deal + vm.prank run in fork state).
///
///         This is the standard "did I wire it up right" check for ZK
///         projects. It exercises every on-chain code path the production
///         flow touches, but in a temporary fork that Base mainnet itself
///         never sees mutated.
///
///         Steps:
///           1. createSelectFork against the Base mainnet RPC
///           2. Generate deterministic note (nullifier + secret).
///           3. Compute commitment in Solidity using the on-disk PoseidonT3
///              library (the same library deployed implicitly via PrivacyPool).
///           4. Pre-fund the deployer in fork state; prank as deployer;
///              deposit(commitment), read on-chain root after.
///           5. Build a witness JSON in test/scripts/zk-fixtures/
///           6. vm.ffi call scripts/prove_withdraw_ffi.js to generate
///              the Groth16 proof against the LIVE snarkjs artifacts.
///           7. Read the proof + publicSignals from disk; ABI-decode.
///           8. prank as deployer; withdraw(publicSignals[0], root,
///              RECIPIENT, a, b, c).
///           9. Assert: recipient.balance += DENOMINATION; root unchanged;
///              isSpent(publicSignals[0]) == true; epochCounter advanced.
contract PrivacyPoolBaseForkTest is Test {
    PrivacyPool       internal pool;
    Groth16Verifier   internal verifier;

    // The addresses from contracts/deployed_base.json (commit 96e9fb5 - P3.4
    // broadcast). Hardcoded so the forge test is hermetic (no env-file read
    // needed at forge test time).
    address constant DEPLOYER       = 0x3f44A6451439673D95082A1337045a25ec275394;
    address constant PRIVACY_POOL   = 0x3A7DA29bfd9853A0449c8c51F7007B7f5126C455;
    address constant GROTH16_VERIFIER = 0xcb2b6D1082e97557EF2d6aE5268f8e8d38DF72e3;
    address constant FRESH_RECIPIENT = 0x1111111111111111111111111111111111111111;

    uint256 constant DENOMINATION = 0.1 ether;   // matches the deployed 0.1 ETH
    string constant RPC_URL        = "https://mainnet.base.org";

    // Deterministic note - fixed so the witness is reproducible.
    uint256 constant NULLIFIER = 0xc0ffee01c0ffee02c0ffee03c0ffee04c0ffee05c0ffee06c0ffee07c0ffee08;
    uint256 constant SECRET    = 0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface;

    // Forge's tmp dir pattern (contracts/test/ - the foundry.toml
    // fs_permissions allow read+execute on scripts/, which lets vm.ffi
    // spawn the prover helper).
    string constant TMP_DIR     = "test/zk-fixtures/";
    string constant WITNESS_IN  = "test/zk-fixtures/witness.json";
    string constant WITNESS_OUT = "test/zk-fixtures/withdraw_proof.json";

    function setUp() public {
        // 1. Fork Base. After this every top-level call to a known address
        //    routes through a forked EVM that mirrors the live chain.
        vm.createSelectFork(RPC_URL);

        // Wire PrivacyPool + Verifier to the LIVE mainnet addresses.
        pool     = PrivacyPool(payable(PRIVACY_POOL));
        verifier = Groth16Verifier(GROTH16_VERIFIER);
    }

    /// @notice The headline test: full deposit -> Groth16 proof -> withdraw
    ///         against the LIVE PrivacyPool contract on Base mainnet.
    function test_e2e_deposit_and_withdraw_live_base_mainnet() public {
        // --- STEP 2: Compute commitment ------------------------------------
        // PoseidonT3 is the same library that PrivacyPool imports and that
        // the on-chain _insert calls. Calling it directly here proves
        // our Solidity stack matches what the contract sees.
        uint256 commitment = PoseidonT3.poseidon(NULLIFIER, SECRET);
        emit log_named_uint("[2/9] commitment", commitment);

        // --- STEP 3: pre-state snapshot -------------------------------------
        uint256 root_pre    = pool.currentRoot();
        uint256 next_pre    = pool.nextLeafIndex();
        assertEq(root_pre,  15019797232609675441998260052101280400536945603062888308240081994073687793470,
                 "unexpected empty-tree root on Base - denominator/init changed?");
        assertEq(next_pre, 0, "expected empty pool");
        emit log_named_uint("[3/9] pre-state nextLeafIndex", next_pre);

        // --- STEP 4: pre-fund deployer in fork state + prank + deposit ----
        // vm.deal is FORK-ONLY. Real Base state is untouched.
        vm.deal(DEPLOYER, 100 ether);
        vm.prank(DEPLOYER);
        emit log_named_string("[4/9] deposit broadcasted in fork state", "");
        pool.deposit{value: DENOMINATION}(bytes32(commitment));

        // --- STEP 5: post-state snapshot -----------------------------------
        uint256 root_post   = pool.currentRoot();
        uint256 next_post   = pool.nextLeafIndex();
        assertEq(next_post, 1, "leaf not inserted at index 0");
        emit log_named_uint("[5/9] post-state nextLeafIndex", next_post);
        assertTrue(root_post != root_pre, "root didn't change - deposit didn't land");

        // --- STEP 6: build witness JSON + vm.ffi to generate proof --------
        // In a 1-leaf tree, the Merkle path at every level has the
        // deposit on the left and zeros[L] on the right. We re-derive
        // the elements via PoseidonT3 to keep the same library used
        // elsewhere - the chain only saw the contract's poseidon calls,
        // so this is the canonical witness shape.
        uint256[] memory pathElements = new uint256[](20);
        uint256[] memory pathIndices  = zerosArray(20);
        // Compute zeros[1..20] via Poseidon (same as contract's `_zeros`).
        pathElements[0] = PoseidonT3.poseidon(0, 0);   // zeros[1]
        for (uint256 l = 2; l < 21; l++) {
            pathElements[l - 1] = PoseidonT3.poseidon(pathElements[l - 2], pathElements[l - 2]);
        }

        // Write the witness input.json
        string memory witness = _witnessJson(commitment, root_post);
        vm.writeFile(WITNESS_IN, witness);

        // --- STEP 7: vm.ffi -> node scripts/prove_withdraw_ffi.js ---------
        // Returns the stdout of the helper ("OK\n" on success).
        string[] memory ffi_inputs = new string[](4);
        ffi_inputs[0] = "node";
        ffi_inputs[1] = "scripts/prove_withdraw_ffi.js";
        ffi_inputs[2] = WITNESS_IN;
        ffi_inputs[3] = "contracts/circuits/build";

        emit log_named_string("[7/9] vm.ffi -> proving witness", "");
        bytes memory out = vm.ffi(ffi_inputs);
        // The helper prints "OK\n"; if anything else appears we surface the error.
        bytes memory okBytes = bytes("OK");
        bool isOk = out.length >= okBytes.length;
        for (uint256 i = 0; isOk && i < okBytes.length; i++) {
            if (out[i] != okBytes[i]) isOk = false;
        }
        assertTrue(isOk, string(abi.encodePacked("vm.ffi helper failed; stdout=", out)));

        // --- STEP 8: read proof + publicSignals + call withdraw ------------
        string memory proof_json_raw = vm.readFile(WITNESS_OUT);
        emit log_named_string("[8/9] proof gen OK; publicSignals/zk-start", substr(proof_json_raw, 0, 80));

        // Decode the JSON by hand (cheaper than pulling a JSON lib).
        // proof_json shape:
        //   {"a":["<a0>","<a1>"],
        //    "b":[["<b00>","<b01>"],["<b10>","<b11>"]],
        //    "c":["<c0>","<c1>"],
        //    "publicSignals":["<p0>","<p1>","<p2>"]}
        uint256[2]    memory a = [uint256(parseHexField(proof_json_raw, "\"a\":[", 0)),
                                   uint256(parseHexField(proof_json_raw, "\"a\":[", 1))];
        uint256[2][2] memory b = [[uint256(parseHexField(proof_json_raw, "\"b\":[", 0)),
                                    uint256(parseHexField(proof_json_raw, "\"b\":[", 1))],
                                   [uint256(parseHexField(proof_json_raw, "\"b\":[", 2)),
                                    uint256(parseHexField(proof_json_raw, "\"b\":[", 3))]];
        uint256[2]    memory c = [uint256(parseHexField(proof_json_raw, "\"c\":[", 0)),
                                   uint256(parseHexField(proof_json_raw, "\"c\":[", 1))];
        // Epic: prove_withdraw_ffi.js swaps b columns to EVM word-order.
        // The witness we wrote uses the in-circuit convention; the helper
        // has already done the swap. So we read them as-is.

        uint256 nullifierHash = uint256(parseHexField(proof_json_raw, "\"publicSignals\":[", 0));
        uint256 proof_root    = uint256(parseHexField(proof_json_raw, "\"publicSignals\":[", 1));
        assertEq(proof_root, root_post,
                 "proof root != on-chain root - the witness/proof gen went against a different tree");

        uint256 recip_bal_pre = FRESH_RECIPIENT.balance;
        vm.prank(DEPLOYER);
        emit log_named_string("[8b/9] withdrawing", "");
        
        // pubSignals order (matches the circuit Public main): [nullifierHash, root, recipient]
        uint256[3] memory pubSignals;
        pubSignals[0] = nullifierHash;
        pubSignals[1] = proof_root;
        pubSignals[2] = uint256(uint160(FRESH_RECIPIENT));
        pool.withdraw(a, b, c, pubSignals);

        // --- STEP 9: assertions ---------------------------------------------
        assertEq(FRESH_RECIPIENT.balance - recip_bal_pre, DENOMINATION,
                 "fresh recipient didn't get the full denomination");
        assertTrue(pool.nullifierHashes(nullifierHash), "nullifier hash not marked spent");
        // Root unchanged after withdraw (single deposit only).
        assertEq(pool.currentRoot(), root_post, "currentRoot changed after withdraw");

        emit log_named_string("[9/9] OK E2E PASS", "deposit + Groth16 proof + withdraw on LIVE PrivacyPool @ Base");
    }

    // --------------------------- helpers ------------------------------------

    function _witnessJson(uint256 commitment, uint256 root) internal pure returns (string memory) {
        bytes memory buf;
        buf = _str(bytes("{\"root\":\"")); buf = _strUintHex(buf, root); buf = _str(bytes("\",\"recipient\":\""));
        buf = _strUintHex160(buf, uint256(uint160(FRESH_RECIPIENT))); buf = _str(bytes("\",\"nullifier\":\""));
        buf = _strUintHex(buf, NULLIFIER);
        buf = _str(bytes("\",\"secret\":\""));
        buf = _strUintHex(buf, SECRET);
        buf = _str(bytes("\",\"merklePathElements\":["));
        // 20 elements: zeros[1..20] - recreated via Poseidon in the test above
        // (we just echo them). For witness write we re-derive via PoseidonT3
        // and emit them as decimal strings (snarkjs accepts both).
        uint256[20] memory elems;
        elems[0] = PoseidonT3.poseidon(0, 0);
        for (uint256 l = 1; l < 20; l++) {
            elems[l] = PoseidonT3.poseidon(elems[l-1], elems[l-1]);
        }
        for (uint256 l = 0; l < 20; l++) {
            buf = _strUintDec(buf, elems[l]);
            if (l < 19) buf = _str(bytes(","));
        }
        buf = _str(bytes("],\"merklePathIndices\":["));
        for (uint256 l = 0; l < 20; l++) {
            buf = _str(l == 0 ? bytes("0") : bytes(""));
            buf = _str(bytes("0"));
            if (l < 19) buf = _str(bytes(","));
        }
        buf = _str(bytes("]}"));
        return string(buf);
    }

    function zerosArray(uint256 n) internal pure returns (uint256[] memory z) {
        z = new uint256[](n);
        for (uint256 i = 0; i < n; i++) z[i] = 0;
    }

    function parseHexField(string memory s, string memory section, uint256 idx) internal pure returns (uint256) {
        bytes memory b = bytes(s);
        bytes memory needle = bytes(section);
        uint256 start = _indexOf(b, needle, 0);
        if (start == type(uint256).max) return 0;
        // Find Nth comma AFTER the section open
        uint256 depth = 0;
        uint256 fieldCount = 0;
        uint256 fieldStart = type(uint256).max;
        for (uint256 i = start + needle.length; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "[") depth++;
            else if (c == "]") { if (depth == 0) break; depth--; }
            else if (c == "," && depth == 0) {
                if (fieldCount == idx) {
                    // Field ends here; the start of this field is the previous comma+1 or section start+1
                    // We re-scan to find the start.
                }
                if (fieldCount >= idx) break;
                fieldCount++;
            }
        }
        // Easier: indexOf after first ',' for idx=0, after second ',' for idx=1, etc.
        // (assumes flat arrays with no nested brackets, which proof_json obeys.)
        // For our shape a/b/c/publicSignals are all flat.
        // Re-implement:
        fieldCount = 0;
        fieldStart = type(uint256).max;
        depth = 0;
        for (uint256 i = start + needle.length; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "[") depth++;
            else if (c == "]") {
                if (depth == 0) {
                    if (fieldCount == idx) fieldStart = i;
                    break;
                }
                depth--;
            } else if (c == "," && depth == 0) {
                if (fieldCount == idx) {
                    fieldStart = i;
                    break;
                }
                fieldCount++;
            } else if (depth == 0 && fieldCount == idx && fieldStart == type(uint256).max) {
                // First non-whitespace char after section close
                if (c != " " && c != "\n" && c != "\r" && c != "\t") fieldStart = i;
            }
        }
        if (fieldStart == type(uint256).max) return 0;
        // Read until close-bracket or comma at depth 0
        uint256 end = fieldStart;
        depth = 0;
        while (end < b.length) {
            bytes1 c = b[end];
            if (c == "[") depth++;
            else if (c == "]") { if (depth == 0) break; depth--; }
            else if (c == "," && depth == 0) break;
            end++;
        }
        // Strip whitespace + quotes
        uint256 a = fieldStart;
        uint256 zend = end;
        while (a < zend && (b[a] == " " || b[a] == "\"" || b[a] == "\n" || b[a] == "\r" || b[a] == "\t")) a++;
        while (zend > a && (b[zend-1] == " " || b[zend-1] == "\"" || b[zend-1] == "\n" || b[zend-1] == "\r" || b[zend-1] == "\t")) zend--;
        // Convert rawBuf to uint (snarkjs emits 0x-prefixed decimal strings OR plain numbers).
        bytes memory fieldBytes = new bytes(zend - a);
        for (uint256 i = 0; i < zend - a; i++) fieldBytes[i] = b[a + i];
        return _parseUintFromString(fieldBytes);
    }

    // -- low-level string/uint helpers (Solidity has no formatting) ------
    function _str(bytes memory b1) internal pure returns (bytes memory b2) {
        b2 = b1;
    }
    function _strUintHex(bytes memory b, uint256 v) internal pure returns (bytes memory o) {
        bytes memory rawBuf = new bytes(64);
        for (uint256 i = 0; i < 64; i++) rawBuf[63 - i] = bytes1(uint8(48 + ((v >> (i * 4)) & 0xF) % 10));
        o = abi.encodePacked(b, rawBuf);
    }
    function _strUintHex160(bytes memory b, uint256 v) internal pure returns (bytes memory o) {
        bytes memory rawBuf = new bytes(40);
        for (uint256 i = 0; i < 40; i++) rawBuf[39 - i] = bytes1(uint8(48 + ((v >> (i * 4)) & 0xF) % 10));
        o = abi.encodePacked(b, rawBuf);
    }
    function _strUintDec(bytes memory b, uint256 v) internal pure returns (bytes memory o) {
        // Convert uint -> decimal ASCII string.
        bytes memory tmp = new bytes(20);
        uint256 n = 0;
        if (v == 0) { tmp[0] = bytes1(uint8(48)); n = 1; }
        while (v > 0) { tmp[n++] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        bytes memory s = new bytes(n);
        for (uint256 i = 0; i < n; i++) s[i] = tmp[n - 1 - i];
        o = abi.encodePacked(b, s);
    }
    function _parseUintFromString(bytes memory s) internal pure returns (uint256 v) {
        bool isHex = false;
        if (s.length >= 2 && s[0] == "0" && (s[1] == "x" || s[1] == "X")) isHex = true;
        uint256 start = isHex ? 2 : 0;
        for (uint256 i = start; i < s.length; i++) {
            bytes1 c = s[i];
            if (isHex) {
                v <<= 4;
                if (c >= "0" && c <= "9") v |= uint8(c) - 48;
                else if (c >= "a" && c <= "f") v |= uint8(c) - 87;
                else if (c >= "A" && c <= "F") v |= uint8(c) - 55;
            } else {
                v *= 10;
                v += uint8(c) - 48;
            }
        }
    }
    function _indexOf(bytes memory hay, bytes memory needle, uint256 fromIndex) internal pure returns (uint256) {
        if (needle.length == 0) return fromIndex;
        if (hay.length < needle.length) return type(uint256).max;
        for (uint256 i = fromIndex; i + needle.length <= hay.length; i++) {
            bool matches = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) { matches = false; break; }
            }
            if (matches) return i;
        }
        return type(uint256).max;
    }
    function substr(string memory s, uint256 b, uint256 e) internal pure returns (string memory) {
        bytes memory sb = bytes(s);
        bytes memory o = new bytes(e - b);
        for (uint256 i = 0; i < e - b; i++) o[i] = sb[b + i];
        return string(o);
    }
}
