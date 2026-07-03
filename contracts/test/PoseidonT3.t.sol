// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PoseidonT3} from "../src/PoseidonT3.sol";

/// @title PoseidonT3 Test (P3.3)
/// @notice Locks the 2-input Poseidon (BN254, circomlib parameters) to its
///         known circomlibjs vectors BEFORE the pool is built on top of it.
///         The single most important assertion is `poseidon(1,2)`:
///
///             7853200120776062878684798364095072458815029376092732009249414926327459813530
///
///         which is the canonical circomlibjs / Tornado-style vector the
///         `withdraw.circom` `Poseidon(2)` compiles against. If on-chain hash
///         !== in-circuit hash the whole privacy pool is unsound (every proof
///         fails), so this is the P3.3 gate.
///
///         The matching JS reference (scripts/verify_poseidon_ref.js) hits the
///         same three vectors over the BN254 field from the vendored constants;
///         this test is the on-chain mirror of that check, using `poseidon`
///         directly rather than via a Merkle path.
contract PoseidonT3Test is Test {
    // Known circomlibjs vectors (BN254 scalar field). See scripts/verify_poseidon_ref.js.
    uint256 internal constant V_0_0 = 14744269619966411208579211824598458697587494354926760081771325075741142829156;
    uint256 internal constant V_1_0 = 18423194802802147121294641945063302532319431080857859605204660473644265519999;
    uint256 internal constant V_1_2 = 7853200120776062878684798364095072458815029376092732009249414926327459813530;

    function test_PoseidonKnownVectors() public pure {
        assertEq(PoseidonT3.poseidon(0, 0), V_0_0, "poseidon(0,0) mismatch");
        assertEq(PoseidonT3.poseidon(1, 0), V_1_0, "poseidon(1,0) mismatch");
        // THE headline vector: circomlibjs / withdraw.circom's Poseidon(2)(1,2).
        assertEq(PoseidonT3.poseidon(1, 2), V_1_2, "poseidon(1,2) mismatch");
    }

    /// @dev Commutativity does NOT hold for Poseidon (lane order matters);
    ///      poseidon(1,2) != poseidon(2,1). Lock that so a future "optimize"
    ///      pass can't silently swap lanes.
    function test_LaneOrderMatters() public pure {
        assertFalse(PoseidonT3.poseidon(1, 2) == PoseidonT3.poseidon(2, 1), "lanes swapped");
    }

    /// @dev BN254 scalar field modulus (mirrors PoseidonT3.Q; the library keeps
    ///      it `internal constant`, so it isn't callable as a getter — declared
    ///      locally here. mulmod/addmod already reduce mod Q inside the library.)
    uint256 internal constant Q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    /// @dev Field-modular: hashing a value >= Q still maps into the field, and
    ///      a ≡ b (mod Q) must hash equal (the Solidity uses mulmod/addmod/Q).
    function test_ReducesModQ() public pure {
        // (Q + 1) and 1 are the same field element.
        assertEq(PoseidonT3.poseidon(Q + 1, 0), PoseidonT3.poseidon(1, 0), "not reduced mod Q");
    }
}
