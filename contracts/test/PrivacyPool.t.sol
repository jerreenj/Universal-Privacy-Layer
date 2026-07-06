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
        // Multi-denom constructor: pass DENOM in initialDenominations[] so the
        // exact pre-P4.1 pool + 0.1 ETH denom tree is recovered.
        uint256[] memory _denoms = new uint256[](1);
        _denoms[0] = DENOM;
        pool = new PrivacyPool(address(mockTrue), _denoms);
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
        if (idx >= leaves.length) return uint256(pool.zeros(h));
        if (h == 0) return leaves[idx];
        uint256 left = _subtree(leaves, idx, h - 1);
        uint256 right = _subtree(leaves, idx + (1 << (h - 1)), h - 1);
        return PoseidonT3.poseidon(left, right);
    }

    // ─── Tree: empty root + multi-deposit roots ────────────────────────────

    /// @notice The empty-tree root equals zeros[DEPTH] and is in the history.
    function test_EmptyRootMatchesZeros() public view {
        assertEq(pool.currentRootOf(DENOM), pool.zeros(DEPTH), "empty root != zeros[DEPTH]");
        assertTrue(pool.isKnownRoot(pool.currentRootOf(DENOM)), "empty root not known");
    }

    /// @notice One deposit: root advances and equals the independently rebuilt
    ///         full-tree root.
    function test_SingleDepositRoot() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        uint32 idxBefore = pool.depositCount(DENOM);

        pool.deposit{value: DENOM}(commitment, DENOM);

        assertEq(pool.depositCount(DENOM), idxBefore + 1, "leaf index did not advance");
        uint256[] memory leaves = new uint256[](1);
        leaves[0] = uint256(commitment);
        assertEq(uint256(pool.currentRootOf(DENOM)), _fullRoot(leaves), "single-deposit root mismatch");
        assertTrue(pool.isKnownRoot(pool.currentRootOf(DENOM)), "new root not in history");
    }

    /// @notice Two deposits: the root equals the independently rebuilt full-tree
    ///         root over both leaves (index 0 left, index 1 right at level 0).
    function test_TwoDepositsRoot() public {
        bytes32 c0 = bytes32(uint256(0xA));
        bytes32 c1 = bytes32(uint256(0xB));
        pool.deposit{value: DENOM}(c0, DENOM);
        uint256 rootAfter0 = uint256(pool.currentRootOf(DENOM));
        pool.deposit{value: DENOM}(c1, DENOM);
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = uint256(c0);
        leaves[1] = uint256(c1);
        assertEq(uint256(pool.currentRootOf(DENOM)), _fullRoot(leaves), "two-deposit root mismatch");
        assertNotEq(uint256(pool.currentRootOf(DENOM)), rootAfter0, "root did not change on 2nd deposit");
    }

    /// @notice Three deposits: spans a carry (level-0 full -> level-1 fills).
    ///         Catches a filledSubtrees-reset bug a 2-leaf test would miss.
    function test_ThreeDepositsRoot() public {
        bytes32 c0 = bytes32(uint256(0xA1));
        bytes32 c1 = bytes32(uint256(0xA2));
        bytes32 c2 = bytes32(uint256(0xA3));
        pool.deposit{value: DENOM}(c0, DENOM);
        pool.deposit{value: DENOM}(c1, DENOM);
        pool.deposit{value: DENOM}(c2, DENOM);
        uint256[] memory leaves = new uint256[](3);
        leaves[0] = uint256(c0);
        leaves[1] = uint256(c1);
        leaves[2] = uint256(c2);
        assertEq(uint256(pool.currentRootOf(DENOM)), _fullRoot(leaves), "three-deposit root mismatch");
    }

    // ─── Revert cases ──────────────────────────────────────────────────────

    function testRevert_WrongDenomination() public {
        // Send 0.05 ETH but declare DENOM (0.1 ETH) — the msg.value check trips
        // BEFORE the tree sees it (we never insert).
        vm.expectRevert(PrivacyPool.MustPayExactDenomination.selector);
        pool.deposit{value: 0.05 ether}(bytes32(uint256(0x1)), DENOM);
    }

    function testRevert_DepositZeroValue() public {
        vm.expectRevert(PrivacyPool.MustPayExactDenomination.selector);
        pool.deposit(bytes32(uint256(0x1)), DENOM);
    }

    function testRevert_UnknownRoot() public {
        // pubSignals with a root that was never recorded.
        uint256[3] memory pub = [uint256(0x1), uint256(0xBAD), uint256(uint160(address(0xB0B)))];
        vm.expectRevert(PrivacyPool.UnknownRoot.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
    }

    function testRevert_RecipientZero() public {
        // Known empty root passes the root check; zero recipient is guarded next.
        uint256 root = uint256(pool.currentRootOf(DENOM));
        uint256[3] memory pub = [uint256(0x1), root, uint256(0)];
        vm.expectRevert(PrivacyPool.RecipientZero.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
    }

    /// @notice With the always-true mock, a withdraw against a known root + a
    ///         fresh nullifier pays out and marks the nullifier spent.
    function test_WithdrawPaysOutAndMarksNullifier() public {
        bytes32 commitment = bytes32(uint256(0xCAFE));
        pool.deposit{value: DENOM}(commitment, DENOM);
        uint256 root = uint256(pool.currentRootOf(DENOM));
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
        pool.deposit{value: DENOM}(commitment, DENOM);
        uint256 root = uint256(pool.currentRootOf(DENOM));
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
        uint256[] memory _denoms2 = new uint256[](1);
        _denoms2[0] = DENOM;
        PrivacyPool strictPool = new PrivacyPool(address(mockFalse), _denoms2);
        vm.deal(address(this), 100 ether);
        strictPool.deposit{value: DENOM}(bytes32(uint256(0xE)), DENOM);
        uint256 root = uint256(strictPool.currentRootOf(DENOM));
        uint256 nullifierHash = 0x333;
        uint256[3] memory pub = [nullifierHash, root, uint256(uint160(address(0xB0B)))];
        vm.expectRevert(PrivacyPool.InvalidProof.selector);
        strictPool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);
        assertFalse(strictPool.nullifierHashes(nullifierHash), "nullifier burned on failed proof");
    }

    // ─── Multi-denomination (P4.1) ─────────────────────────────────────────

    /// @notice addDenomination registers a new denomination; deposits at it
    ///         succeed. The new denom's tree is independent (its root differs
    ///         from DENOM's tree by zero leaves).
    function test_MultiDenom_AddDenominationWorks() public {
        uint256 newDenom = 0.01 ether;
        assertFalse(pool.isDenominationEnabled(newDenom));
        pool.addDenomination(newDenom);
        assertTrue(pool.isDenominationEnabled(newDenom));
        assertEq(pool.depositCount(newDenom), 0, "new denom should start empty");

        // Root of the new denom should equal zeros[DEPTH] (empty tree).
        assertEq(pool.currentRootOf(newDenom), pool.zeros(DEPTH), "new denom empty root != zeros[DEPTH]");

        // First deposit at the new denomination.
        bytes32 commitment = bytes32(uint256(0xDEAD));
        pool.deposit{value: newDenom}(commitment, newDenom);
        assertEq(pool.depositCount(newDenom), 1, "leaf 0 not inserted in new denom");
        assertNotEq(pool.currentRootOf(newDenom), pool.zeros(DEPTH), "root did not change after 1 deposit");

        // And it's DENOM-independent — DENOM's tree is still empty.
        assertEq(pool.depositCount(DENOM), 0, "DENOM tree was touched by new-denom deposit");
    }

    /// @notice A root from one denomination's tree is NOT shared with another
    ///         denomination's tree — each denom has its own ring buffer of
    ///         recent roots. A deposit at dA MUST not advance dB's currentRoot.
    function test_MultiDenom_RootsAreIsolatedPerDenom() public {
        uint256 dA = DENOM; // 0.1 ether (registered in setUp)
        uint256 dB = 0.01 ether;
        pool.addDenomination(dB); // register dB; tree state created

        // Both denoms start with the empty root.
        assertEq(uint256(pool.currentRootOf(dB)), uint256(pool.zeros(DEPTH)), "dB not seeded at empty root");

        // Single deposit at dA — dA's tree advances, dB's tree MUST NOT.
        pool.deposit{value: dA}(bytes32(uint256(0xA1)), dA);
        bytes32 rootA = pool.currentRootOf(dA);

        assertNotEq(rootA, pool.zeros(DEPTH), "dA root did not advance");
        assertEq(
            uint256(pool.currentRootOf(dB)),
            uint256(pool.zeros(DEPTH)),
            "dB tree was touched by dA deposit (isolation broken)"
        );
        assertEq(pool.depositCount(dB), 0, "dB leaf counter advanced despite no deposit");
    }

    /// @notice The spent set is GLOBAL across denominations — once a nullifier is
    ///         spent, the same note cannot be withdrawn from another denom.
    function test_MultiDenom_GlobalSpentSet() public {
        uint256 dA = DENOM;
        uint256 dB = 0.01 ether;
        pool.addDenomination(dB);

        // Deposit at dA then spend it (record the nullifier).
        pool.deposit{value: dA}(bytes32(uint256(0xC1)), dA);
        bytes32 rootA = pool.currentRootOf(dA);
        uint256 nullifierHash = 0x777;
        uint256[3] memory pub = [nullifierHash, uint256(rootA), uint256(uint160(address(0xB0B)))];
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);

        // Same nullifier tried a second time on dA is rejected (already spent in dA).
        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pub);

        // And replaying the SAME nullifierHash against a DIFFERENT denom (dB)
        // — even with a fresh deposit at dB that grants dB's pool real ETH —
        // is ALSO rejected. The global `nullifierHashes` set has no concept
        // of "which denom this came from"; a spent note is spent everywhere.
        pool.deposit{value: dB}(bytes32(uint256(0xC2)), dB);
        bytes32 rootB = pool.currentRootOf(dB);
        uint256[3] memory pubB = [nullifierHash, uint256(rootB), uint256(uint160(address(0xB0B2)))];
        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.withdraw([uint256(1), 2], [[uint256(3), 4], [uint256(5), 6]], [uint256(7), 8], pubB);
    }

    /// @notice Deposits in two different denoms do not collide — each denom
    ///         has its own Merkle tree with its own sequence of roots.
    function test_MultiDenom_IndependentDepositCounts() public {
        uint256 dA = DENOM;
        uint256 dB = 0.01 ether;
        pool.addDenomination(dB); // register dB before depositing into it

        pool.deposit{value: dA}(bytes32(uint256(0xA)), dA);
        pool.deposit{value: dA}(bytes32(uint256(0xB)), dA);
        pool.deposit{value: dB}(bytes32(uint256(0xC)), dB);
        pool.deposit{value: dB}(bytes32(uint256(0xD)), dB);
        pool.deposit{value: dB}(bytes32(uint256(0xE)), dB);

        assertEq(pool.depositCount(dA), 2, "dA deposit count");
        assertEq(pool.depositCount(dB), 3, "dB deposit count");
        assertNotEq(
            uint256(pool.currentRootOf(dA)),
            uint256(pool.currentRootOf(dB)),
            "different denoms should have independent roots"
        );
    }
}
