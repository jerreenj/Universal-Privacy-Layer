// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {Groth16Verifier} from "../src/Verifier.sol";

/// @title PrivacyPool End-to-End Test (P3.3-C — REAL Groth16 proof)
/// @notice THE P3.3 gate: a real snarkjs-generated Groth16 proof, verified
///         on-chain by the real Groth16Verifier, end-to-end through the pool.
///
///         The proof was generated offline (scripts/zk_prove_e2e.js builds the
///         same incremental Poseidon Merkle tree the contract uses, writes the
///         witness input; snarkjs in WSL runs the wasm witness + groth16 prove).
///         The deposit commitment = Poseidon(nullifier, secret) is inserted as
///         leaf 0; the proof's `root` is the tree root after that insert; the
///         proof's `nullifierHash` = Poseidon(nullifier); `recipient` = 0x..0B0B.
///
///         Public-signal order (asserted empirically from snarkjs public.json):
///           pubSignals = [nullifierHash, root, recipient]
///         which is exactly what PrivacyPool.withdraw passes to the verifier.
///
///         This test replays the SAME deposit on-chain so the contract's root
///         equals the proof's root, then submits the proof. If the on-chain
///         Poseidon !== in-circuit Poseidon (the P3.3-A guarantee) the proof
///         would fail here — so this is the integrated soundness check.
contract PrivacyPoolE2ETest is Test {
    PrivacyPool internal pool;
    Groth16Verifier internal verifier;

    uint256 internal constant DENOM = 0.1 ether;

    // ─── Deposit witness (from scripts/zk_prove_e2e.js tree.json) ──────────
    // commitment = Poseidon(nullifier=0x12345, secret=0x67890), leaf at index 0.
    bytes32 internal constant COMMITMENT =
        bytes32(uint256(0x17963aacf7154741de6ea591c63f9af7f984bfeb786fd1e41fc21917d39c8349));

    // ─── Real Groth16 proof (snarkjs groth16 prove, exportSolidityCallData) ─
    // a = proofA
    uint256 internal constant PA0 = 0x243bf150fa7fba06f21482b650e8df5d0267f6c4770a1fee7da18573a51685ef;
    uint256 internal constant PA1 = 0x1b20232bc4cf6ebcd78152a83f1188d78e9df002be4b835cc45c7660a7e8c287;
    // b = proofB (Fq2 point, snarkjs-ordered [[xC0,xC1],[yC0,yC1]])
    uint256 internal constant PB00 = 0x1d61da80ce7e6bf1dddf01e139cdb639c329d3f6ec8e534d1de7c74996bc9b04;
    uint256 internal constant PB01 = 0x21351415aebd65d59350f76b7070ddf170996332f079abe86d62e9bbc28a2956;
    uint256 internal constant PB10 = 0x2fe5103e3482c45f96d810ee26fce0880503bbe45d2388b646994e93dfed1de1;
    uint256 internal constant PB11 = 0x265795d17eeb17b53dacf287b9a325153160cccbb6d1b372248df89b41e6c507;
    // c = proofC
    uint256 internal constant PC0 = 0x227bff30542db41e76e8183b7dac3693b9d98e0e1623e75a23463f91476878aa;
    uint256 internal constant PC1 = 0x25f90d59bbf2dd37d00a4b3e7e782d2f3230da77e995a3535ddcbb99051cf3cb;

    // ─── Public signals: [nullifierHash, root, recipient] ───────────────────
    uint256 internal constant NULLIFIER_HASH = 0x1b9479c47d92b1ddc294353cdb6525f1a462926d42367cfa1cc3c844c2f7136e;
    uint256 internal constant ROOT = 0x1522cb58e7bb56f829fd23a4d86bb6d8a82fb2375905ee349b6995dd8f3c6215;
    address internal constant RECIPIENT = address(0x0B0B);

    function setUp() public {
        verifier = new Groth16Verifier();
        pool = new PrivacyPool(DENOM, address(verifier));
        vm.deal(address(this), 100 ether);
    }

    // Helper: build the proof arrays from the constants above.
    function _proof()
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory pub)
    {
        a = [PA0, PA1];
        b = [[PB00, PB01], [PB10, PB11]];
        c = [PC0, PC1];
        pub = [NULLIFIER_HASH, ROOT, uint256(uint160(RECIPIENT))];
    }

    /// @notice The headline test: deposit the commitment, then withdraw with the
    ///         REAL Groth16 proof. The on-chain verifier accepts it and the
    ///         recipient is paid. This proves on-chain Poseidon === in-circuit
    ///         Poseidon AND the full withdraw path works with a real proof.
    function test_RealProofDepositAndWithdraw() public {
        // 1. Deposit the commitment as leaf 0. The on-chain root after this
        //    insert MUST equal the proof's ROOT — if it doesn't, the on-chain
        //    Poseidon diverges from the circuit's and the proof would fail.
        pool.deposit{value: DENOM}(COMMITMENT);
        assertEq(pool.currentRoot(), ROOT, "on-chain root != proof root (Poseidon divergence)");
        assertEq(pool.nextLeafIndex(), 1, "leaf not inserted at index 0");

        // 2. Submit the real Groth16 proof.
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory pub) = _proof();
        uint256 balBefore = RECIPIENT.balance;
        pool.withdraw(a, b, c, pub);

        // 3. Recipient paid + nullifier marked spent.
        assertEq(RECIPIENT.balance, balBefore + DENOM, "recipient not paid by real proof");
        assertTrue(pool.nullifierHashes(NULLIFIER_HASH), "nullifier not spent after real withdraw");
    }

    /// @notice Re-submitting the SAME proof (same nullifier) reverts: the
    ///         nullifier is now spent, so even a valid proof cannot double-spend.
    function testRevert_RealProofDoubleSpend() public {
        pool.deposit{value: DENOM}(COMMITMENT);
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory pub) = _proof();
        pool.withdraw(a, b, c, pub); // first withdraw OK
        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.withdraw(a, b, c, pub); // same nullifier -> revert
    }

    /// @notice A tampered proof (wrong proofC) is rejected by the real verifier.
    ///         Confirms the verifier actually checks the pairing, not just that
    ///         the inputs are well-formed.
    function testRevert_TamperedProofRejected() public {
        pool.deposit{value: DENOM}(COMMITMENT);
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory pub) = _proof();
        // Flip one byte of proofC[0] — breaks the pairing.
        c[0] = PC0 ^ 1;
        vm.expectRevert(PrivacyPool.InvalidProof.selector);
        pool.withdraw(a, b, c, pub);
    }

    /// @notice A proof against a root the contract never recorded is rejected
    ///         before the verifier even runs (UnknownRoot), even though the
    ///         proof itself is valid for its own (different) tree.
    function testRevert_ProofAgainstUnknownRoot() public {
        // Do NOT deposit — the contract root is the empty root, not ROOT.
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory pub) = _proof();
        vm.expectRevert(PrivacyPool.UnknownRoot.selector);
        pool.withdraw(a, b, c, pub);
    }
}
