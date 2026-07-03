// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {PoseidonT3} from "../src/PoseidonT3.sol";
import {Groth16Verifier} from "../src/Verifier.sol";

/// @title MockGroth16Verifier
/// @notice Stand-in for the real Groth16 verifier so the P3.3-B gate can test
///         the pool's Merkle tree + auth logic WITHOUT a real proof (the real
///         proof round-trip is the P3.3-C gate). Returns a fixed bool.
contract MockGroth16Verifier {
    bool public returnValue;

    constructor(bool v) {
        returnValue = v;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[3] calldata)
        external
        view
        returns (bool)
    {
        return returnValue;
    }
}

/// @title PrivacyPool Test (P3.3-B — tree + auth logic, mock verifier)
/// @notice Locks the incremental Poseidon Merkle tree + the withdraw auth path
///         BEFORE wiring a real Groth16 proof (P3.3-C). The tree is verified
///         against an INDEPENDENT full rebuild from the leaf set (not the
///         incremental _insert path), so a bug in _insert surfaces here.
contract PrivacyPoolTest is Test {
    PrivacyPool internal pool;
    Groth16Verifier internal realVerifier; // deployed; used by P3.3-C
    MockGroth16Verifier internal mockTrue;
    MockGroth16Verifier internal mockFalse;

    uint256 internal constant DENOM = 0.1 ether;
    // Mirrors PrivacyPool.MERKLE_DEPTH (contract constants are not reachable
    // via the type name in Solidity, only via an instance getter). Asserted at
    // runtime below via pool.zeros(DEPTH) (would revert if they diverged).
    uint256 internal constant DEPTH = 20;

    function setUp() public {
        realVerifier = new Groth16Verifier();
        mockTrue = new MockGroth16Verifier(true);
        mockFalse = new MockGroth16Verifier(false);
        pool = new PrivacyPool(DENOM, address(mockTrue));
        vm.deal(address(this), 100 ether);
    }

    // ─── Independent full-tree root rebuild ────────────────────────────────

    /// @dev Independently compute the Merkle root of the inserted leaves by a
    ///      SPARSE recursive rebuild over ABSOLUTE leaf indices. subtree(idx, h)
    ///      returns the hash of the height-h subtree whose leftmost leaf index
    ///      is idx. Recursion decides left/right from the offset at each level,
    ///      so a leaf anywhere in the tree pairs correctly with zeros[h]
    ///      siblings. O(deposits * DEPTH), not O(2^DEPTH) — runs in-test for
    ///      depth 20 and does NOT reuse _insert (genuine independent check).
    function _fullRoot(uint256[] memory leaves) internal view returns (uint256) {
        require(leaves.length <= 2 ** DEPTH, "too many leaves");
        return _subtree(leaves, 0, uint32(DEPTH));
    }

    /// @dev Hash of the height-h subtree whose leftmost leaf is at global index
    ///      idx. Consumes leaves greedily: if none remain, the subtree is empty
    ///      (zeros[h]); at h==0 it is either the next leaf or zeros[0].
    function _subtree(uint256[] memory leaves, uint256 idx, uint32 h) internal view returns (uint256) {
        if (idx >= leaves.length) return pool.zeros(h);
        if (h == 0) return leaves[idx];
        uint256 left = _subtree(leaves, idx, h - 1);
        uint256 right = _subtree(leaves, idx + (1 << (h - 1)), h - 1);
        return PoseidonT3.poseidon(left, right);
    }

    // ─── Tree: empty root + multi-deposit roots ────────────────────────────

    /// @notice The empty-tree root equals zeros[DEPTH] and is in the history.
    function test_EmptyRootMatchesZeros() public view {
        assertEq(pool.currentRoot(), pool.zeros(DEPTH), "empty root != zeros[DEPTH]");
        assertTrue(pool.isKnownRoot(pool.currentRoot()), "empty root not known");
    }

    /// @notice One deposit: root advances and equals the independently rebuilt
    ///         full-tree root.
    function test_SingleDepositRoot() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        uint32 idxBefore = pool.nextLeafIndex();

        pool.deposit{value: DENOM}(commitment);

        assertEq(pool.nextLeafIndex(), idxBefore + 1, "leaf index did not advance");
        uint256[] memory leaves = new uint256[](1);
        leaves[0] = uint256(commitment);
        assertEq(pool.currentRoot(), _fullRoot(leaves), "single-deposit root mismatch");
        assertTrue(pool.isKnownRoot(pool.currentRoot()), "new root not in history");
    }

    /// @notice Two deposits: the root equals the independently rebuilt full-tree
    ///         root over both leaves (index 0 left, index 1 right at level 0).
    function test_TwoDepositsRoot() public {
        bytes32 c0 = bytes32(uint256(0xA));
        bytes32 c1 = bytes32(uint256(0xB));
        pool.deposit{value: DENOM}(c0);
        uint256 rootAfter0 = pool.currentRoot();
        pool.deposit{value: DENOM}(c1);
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = uint256(c0);
        leaves[1] = uint256(c1);
        assertEq(pool.currentRoot(), _fullRoot(leaves), "two-deposit root mismatch");
        assertNotEq(pool.currentRoot(), rootAfter0, "root did not change on 2nd deposit");
    }

    /// @notice Three deposits: spans a carry (level-0 full -> level-1 fills).
    ///         Catches a filledSubtrees-reset bug a 2-leaf test would miss.
    function test_ThreeDepositsRoot() public {
        bytes32 c0 = bytes32(uint256(0xA1));
        bytes32 c1 = bytes32(uint256(0xA2));
        bytes32 c2 = bytes32(uint256(0xA3));
        pool.deposit{value: DENOM}(c0);
        pool.deposit{value: DENOM}(c1);
        pool.deposit{value: DENOM}(c2);
        uint256[] memory leaves = new uint256[](3);
        leaves[0] = uint256(c0);
        leaves[1] = uint256(c1);
        leaves[2] = uint256(c2);
        assertEq(pool.currentRoot(), _fullRoot(leaves), "three-deposit root mismatch");
    }

    // ─── Revert cases ──────────────────────────────────────────────────────

    function testRevert_WrongDenomination() public {
        vm.expectRevert(PrivacyPool.MustPayExactDenomination.selector);
        pool.deposit{value: 0.05 ether}(bytes32(uint256(0x1)));
    }

    function testRevert_DepositZeroValue() public {
        vm.expectRevert(PrivacyPool.MustPayExactDenomination.selector);
        pool.deposit(bytes32(uint256(0x1)));
    }

    function testRevert_UnknownRoot() public {
        // pubSignals with a root that was never recorded.
        uint256[3] memory pub = [uint256(0x1), uint256(0xBAD), uint256(uint160(address(0xB0B)))];
        vm.expectRevert(PrivacyPool.UnknownRoot.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
    }

    function testRevert_RecipientZero() public {
        // Known empty root passes the root check; zero recipient is guarded next.
        uint256 root = pool.currentRoot();
        uint256[3] memory pub = [uint256(0x1), root, uint256(0)];
        vm.expectRevert(PrivacyPool.RecipientZero.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
    }

    /// @notice With the always-true mock, a withdraw against a known root + a
    ///         fresh nullifier pays out and marks the nullifier spent.
    function test_WithdrawPaysOutAndMarksNullifier() public {
        bytes32 commitment = bytes32(uint256(0xCAFE));
        pool.deposit{value: DENOM}(commitment);
        uint256 root = pool.currentRoot();
        address recipient = address(0xB0B);
        uint256 nullifierHash = 0x111;
        uint256 balBefore = recipient.balance;

        uint256[3] memory pub = [nullifierHash, root, uint256(uint160(recipient))];
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);

        assertEq(recipient.balance, balBefore + DENOM, "recipient not paid");
        assertTrue(pool.nullifierHashes(nullifierHash), "nullifier not marked spent");
    }

    /// @notice Re-using a nullifier reverts even with a valid (mock) proof.
    function testRevert_DoubleSpend() public {
        bytes32 commitment = bytes32(uint256(0xD0));
        pool.deposit{value: DENOM}(commitment);
        uint256 root = pool.currentRoot();
        address recipient = address(0xB0B);
        uint256 nullifierHash = 0x222;
        uint256[3] memory pub = [nullifierHash, root, uint256(uint160(recipient))];
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
    }

    /// @notice With the always-FALSE mock verifier, a withdraw reverts on proof
    ///         failure BEFORE the nullifier is marked spent (atomicity: a failed
    ///         proof cannot burn a nullifier).
    function testRevert_InvalidProofDoesNotBurnNullifier() public {
        PrivacyPool strictPool = new PrivacyPool(DENOM, address(mockFalse));
        vm.deal(address(this), 100 ether);
        strictPool.deposit{value: DENOM}(bytes32(uint256(0xE)));
        uint256 root = strictPool.currentRoot();
        uint256 nullifierHash = 0x333;
        uint256[3] memory pub = [nullifierHash, root, uint256(uint160(address(0xB0B)))];
        vm.expectRevert(PrivacyPool.InvalidProof.selector);
        strictPool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
        assertFalse(strictPool.nullifierHashes(nullifierHash), "nullifier burned on failed proof");
    }
}
