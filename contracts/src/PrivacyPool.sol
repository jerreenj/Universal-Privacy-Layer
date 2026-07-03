// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Groth16Verifier} from "./Verifier.sol";
import {PoseidonT3} from "./PoseidonT3.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PrivacyPool
 * @notice UPL ZK privacy pool (Phase 3, Path B) — a Tornado-style fixed-
 *         denomination pool on Base. Deposits commit
 *         `Poseidon(nullifier, secret)` into an incremental Poseidon Merkle
 *         tree (depth 20); withdrawals prove in-circuit knowledge of
 *         `(nullifier, secret, merklePath)` against the current root and
 *         reveal ONLY `(nullifierHash, root, recipient)` — the deposit and the
 *         withdrawal are cryptographically unlinkable. Double-spends are
 *         blocked by the on-chain `nullifierHashes` set.
 *
 * @dev The on-chain Poseidon MUST equal the in-circuit Poseidon (same circomlib
 *      constants) or every proof fails. That equivalence is locked by
 *      `PoseidonT3.t.sol` (headline vector `poseidon(1,2)`). The Merkle tree is
 *      incremental: each level hashes `Poseidon(left, right)` and caches the
 *         current subtree filled-ness so insert is O(depth) not O(2^depth).
 *      Zero leaves/subtrees are precomputed (`zeros[level]`) so an empty
 *      subtree's hash is known without materialising it.
 *
 *      Public-signal order passed to the Groth16 verifier
 *      (`Groth16Verifier.verifyProof`): `[nullifierHash, root, recipient]` —
 *      snarkjs orders public outputs before public inputs, and `withdraw.circom`
 *      declares `public [root, recipient]` + output `nullifierHash`. This order
 *      is asserted end-to-end in `PrivacyPool.t.sol` with a real proof.
 */
contract PrivacyPool is Ownable, ReentrancyGuard {
    using PoseidonT3 for *;

    // ─── Tree configuration ────────────────────────────────────────────────
    /// @notice Merkle tree depth. 2^20 = 1,048,576 deposits max. Must match
    ///         `withdraw.circom`'s `Withdraw(20)`.
    uint256 public constant MERKLE_DEPTH = 20;
    /// @notice How many recent roots we keep for withdrawal validation. A
    ///         deposit between proof-generation and on-chain withdraw advances
    ///         the root; the withdraw still succeeds if the proof's root is in
    ///         this window. 100 ≈ a few minutes of deposits — ample for browser
    ///         proof latency (~5–20s) plus block time.
    uint256 public constant ROOT_HISTORY_SIZE = 100;

    /// @notice Fixed deposit denomination (in wei). Fixed amounts are what make
    ///         pools anonymous — a 0.1 ETH deposit is indistinguishable from any
    ///         other 0.1 ETH deposit.
    uint256 public immutable denomination;

    // ─── Verifier ──────────────────────────────────────────────────────────
    Groth16Verifier public immutable verifier;

    // ─── Incremental Merkle tree state ─────────────────────────────────────
    /// @dev zeros[l] = the hash of an empty subtree of height l (l=0 is a leaf
    ///      = 0). zeros[0] = 0; zeros[l] = Poseidon(zeros[l-1], zeros[l-1]).
    uint256[MERKLE_DEPTH + 1] public zeros;
    /// @dev filledSubtrees[l] = the current (rightmost path's) subtree hash at
    ///      level l. Updated on each insert to reflect the newly-filled leaf.
    uint256[MERKLE_DEPTH] public filledSubtrees;
    /// @dev The current Merkle root (after the most recent deposit).
    uint256 public currentRoot;
    /// @dev Index of the next leaf to insert.
    uint32 public nextLeafIndex;
    /// @dev Ring buffer of recent roots for withdraw validation.
    uint256[ROOT_HISTORY_SIZE] public roots;
    /// @dev Whether a given root is currently in the history window. Maps
    ///      root => bool. Kept in sync with `roots` on insert.
    mapping(uint256 => bool) public isKnownRoot;
    /// @dev nullifierHash => spent. The double-spend guard.
    mapping(uint256 => bool) public nullifierHashes;

    // ─── Events ────────────────────────────────────────────────────────────
    /// @notice Emitted on deposit. `commitment` is the inserted leaf; the leaf
    ///         `index` lets the depositor (off-chain) compute the Merkle path
    ///         for the eventual withdrawal proof.
    event Deposit(bytes32 indexed commitment, uint32 indexed leafIndex, uint256 root);
    /// @notice Emitted on a successful withdrawal. `nullifierHash` is the only
    ///         on-chain link between a deposit and a withdraw — and by design
    ///         it is unlinkable to the originating commitment.
    event Withdrawal(address indexed recipient, uint256 nullifierHash, uint256 root);

    // ─── Errors ────────────────────────────────────────────────────────────
    error MustPayExactDenomination();
    error MerkleTreeFull();
    error UnknownRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error TransferFailed();
    error RecipientZero();

    constructor(uint256 _denomination, address _verifier) Ownable(msg.sender) {
        if (_verifier == address(0)) revert RecipientZero();
        denomination = _denomination;
        verifier = Groth16Verifier(_verifier);

        // Precompute zero subtrees and seed the incremental tree.
        // zeros[0] = 0 (an empty leaf). Each higher level is the hash of two
        // empty children. filledSubtrees starts as the zeros (empty tree), so
        // the first insert produces a path of sibling = zeros[0..DEPTH-1].
        zeros[0] = 0;
        for (uint256 l = 1; l <= MERKLE_DEPTH; l++) {
            zeros[l] = PoseidonT3.poseidon(zeros[l - 1], zeros[l - 1]);
        }
        for (uint256 l = 0; l < MERKLE_DEPTH; l++) {
            filledSubtrees[l] = zeros[l];
        }
        currentRoot = zeros[MERKLE_DEPTH];
        // Seed the root history with the empty root so the first withdraw is
        // never blocked by "unknown root" before any deposit has happened.
        roots[0] = currentRoot;
        isKnownRoot[currentRoot] = true;
    }

    // ─── Deposit ───────────────────────────────────────────────────────────
    /**
     * @notice Deposit `denomination` ETH into the pool, committing `commitment`
     *         (= Poseidon(nullifier, secret), computed off-chain) as a new leaf.
     *         Emits the leaf index so the depositor can derive the Merkle path.
     * @param commitment The leaf = Poseidon(nullifier, secret). The depositor
     *        keeps (nullifier, secret) private; only `commitment` is on-chain.
     */
    function deposit(bytes32 commitment) external payable nonReentrant {
        if (msg.value != denomination) revert MustPayExactDenomination();
        uint32 leafIndex = nextLeafIndex;
        if (leafIndex >= 2 ** MERKLE_DEPTH) revert MerkleTreeFull();

        _insert(uint256(commitment));

        // Record the new root in the history ring buffer (oldest evicted).
        uint256 newRoot = currentRoot;
        uint256 slot = leafIndex % ROOT_HISTORY_SIZE;
        // Clear the known-root flag for the root we're about to overwrite.
        isKnownRoot[roots[slot]] = false;
        roots[slot] = newRoot;
        isKnownRoot[newRoot] = true;

        emit Deposit(commitment, leafIndex, newRoot);
    }

    // ─── Withdraw ──────────────────────────────────────────────────────────
    /**
     * @notice Withdraw `denomination` ETH to `recipient` by proving — without
     *         revealing the deposit — knowledge of `(nullifier, secret, path)`
     *         whose `Poseidon(nullifier, secret)` commitment is a leaf under
     *         `root`, and revealing `nullifierHash = Poseidon(nullifier)`.
     * @dev The proof is verified by `Groth16Verifier`. Public signals passed to
     *      the verifier, in order: `[nullifierHash, root, recipient]`.
     */
    function withdraw(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[3] calldata pubSignals // [nullifierHash, root, recipient]
    ) external nonReentrant {
        uint256 nullifierHash = pubSignals[0];
        uint256 root = pubSignals[1];
        address recipient = address(uint160(pubSignals[2]));

        if (recipient == address(0)) revert RecipientZero();
        if (!isKnownRoot[root]) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();

        // Verify the Groth16 proof against the public signals. The verifier is
        // a view (pure pairing check) — it cannot mutate pool state.
        if (!verifier.verifyProof(proofA, proofB, proofC, pubSignals)) revert InvalidProof();

        // Mark the nullifier spent BEFORE the external call (checks-effects-interactions).
        nullifierHashes[nullifierHash] = true;

        (bool ok,) = recipient.call{value: denomination}("");
        if (!ok) revert TransferFailed();

        emit Withdrawal(recipient, nullifierHash, root);
    }

    // ─── Incremental Merkle insert ─────────────────────────────────────────
    /// @dev Insert `leaf` at `nextLeafIndex`, advancing the root in O(depth).
    ///      Walks up the tree: at each level the new leaf hashes with its
    ///      sibling (the filledSubtree on the opposite side) via Poseidon, and
    ///      the filledSubtree is reset to the zero-subtree when a level becomes
    ///      full (carries to the next level).
    function _insert(uint256 leaf) internal {
        uint32 index = nextLeafIndex;
        uint256 current = leaf;
        for (uint32 l = 0; l < MERKLE_DEPTH; l++) {
            bool isRight = (index >> l) & 1 == 1;
            if (isRight) {
                // The left sibling is the already-filled left subtree at this
                // level (filledSubtrees[l], a height-l subtree root). This
                // level's left subtree is now complete — reset it to the empty
                // hash so the next insert that reaches this level starts fresh.
                uint256 left = filledSubtrees[l];
                filledSubtrees[l] = zeros[l];
                current = PoseidonT3.poseidon(left, current);
            } else {
                // The new node is the left child; its right sibling is an empty
                // subtree (zeros[l]). Remember the new node as this level's
                // filled left subtree (the incoming `current` IS the height-l
                // subtree root being placed here), then carry the hash up.
                filledSubtrees[l] = current;
                current = PoseidonT3.poseidon(current, zeros[l]);
            }
        }
        currentRoot = current;
        nextLeafIndex = index + 1;
    }

    // ─── Views ─────────────────────────────────────────────────────────────
    /// @notice Whether `root` is a valid (recent) Merkle root for withdrawals.
    function isKnownRoot_(uint256 root) external view returns (bool) {
        return isKnownRoot[root];
    }

    /// @notice How many deposits have been made so far.
    function depositCount() external view returns (uint32) {
        return nextLeafIndex;
    }

    /// @notice Sweep ETH sent to the contract by accident (e.g. selfdestruct
    ///         refund). Cannot sweep pool funds — only the *excess* above the
    ///         pool's locked balance. Owner-only.
    function sweep(address to) external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        // The locked pool value is depositCount * denomination; only the
        // accidental excess is recoverable.
        uint256 locked = uint256(nextLeafIndex) * denomination;
        uint256 excess = balance > locked ? balance - locked : 0;
        if (excess > 0) {
            (bool ok,) = to.call{value: excess}("");
            if (!ok) revert TransferFailed();
        }
    }

    receive() external payable {}
}
