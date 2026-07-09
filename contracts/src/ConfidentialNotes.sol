// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ConfidentialNotes — zero-leak amount hiding on Base.
 * @notice No vault. No USDC. No wrapping. This contract stores only
 *         note commitments (hashes) and nullifier hashes. Transfers
 *         between Privacy Cloak users are zero-value ZK proof
 *         verifications — no amount, no recipient, no sender identity
 *         is ever visible on BaseScan.
 *
 * @dev The contract is intentionally simple:
 *        - A Merkle tree of note commitments (Poseidon hashes)
 *        - A spent-nullifier set (double-spend guard)
 *        - A single function: createNote (verify proof, nullify old,
 *          insert new)
 *
 *      No token. No deposit. No withdraw. No value. The contract
 *      NEVER touches USDC. Settlement (turning a note into real USDC)
 *      is handled separately by the relayer + stealth address system.
 *
 *      Public signals (4 only — NO recipient):
 *        [nullifierHash, newCommitment, encryptedAmount, root]
 *
 *      What BaseScan sees for a createNote transaction:
 *        from: relayer (not the customer)
 *        to: this contract (not the recipient)
 *        value: 0 ETH
 *        calldata: proof + 4 hashes
 *        events: NoteCreated(4 hashes)
 *        NO amount. NO recipient address. NO USDC transfer.
 */
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoseidonT3} from "./PoseidonT3.sol";
import {Groth16Verifier as ConfidentialNotesVerifier} from "./ConfidentialNotesVerifier.sol";

contract ConfidentialNotes is Ownable, ReentrancyGuard {
    using PoseidonT3 for *;

    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant MERKLE_DEPTH = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 100;

    // ─── Verifier ───────────────────────────────────────────────
    ConfidentialNotesVerifier public immutable verifier;

    // ─── Merkle Tree ────────────────────────────────────────────
    bytes32[MERKLE_DEPTH] public filledSubtrees;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    bytes32 public currentRoot;
    uint32 public nextLeafIndex;
    bytes32[MERKLE_DEPTH + 1] public zeros;

    // ─── Note state ─────────────────────────────────────────────
    mapping(uint256 => bool) public nullifierHashes;

    // ─── Events (ALL hashes — no plaintext anywhere) ────────────
    event NoteCreated(bytes32 indexed newCommitment, bytes32 encryptedAmount, uint256 nullifierHash, bytes32 root);

    // ─── Errors ─────────────────────────────────────────────────
    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownRoot();
    error MerkleTreeFull();

    // ─── Constructor ────────────────────────────────────────────
    constructor(address _verifier, address _owner) Ownable(_owner) {
        verifier = ConfidentialNotesVerifier(_verifier);

        // Precompute zero subtrees (same as PrivacyPool.sol).
        zeros[0] = bytes32(0);
        for (uint32 l = 1; l <= MERKLE_DEPTH; l++) {
            zeros[l] = bytes32(PoseidonT3.poseidon(uint256(zeros[l - 1]), uint256(zeros[l - 1])));
        }
        currentRoot = zeros[MERKLE_DEPTH];
        roots[0] = currentRoot;
    }

    // ─── Create Note (the ONLY function) ────────────────────────
    /**
     * @notice Create a new confidential note by spending an old one.
     * @dev    This is a ZERO-VALUE transaction. No USDC moves. No
     *         amount is visible. The proof verifies:
     *           - Caller owns the old note (nullifier + secret)
     *           - Old note is in the Merkle tree under `root`
     *           - amount > 0 and amount < 2^64
     *           - newCommitment binds the note to the recipient
     *           - encryptedAmount lets the recipient identify their note
     *
     *         The recipient's address/viewKey is a PRIVATE input in
     *         the proof — it NEVER appears on-chain.
     *
     * @param proofA       Groth16 proof part A
     * @param proofB       Groth16 proof part B
     * @param proofC       Groth16 proof part C
     * @param pubSignals   [nullifierHash, newCommitment, encryptedAmount, root]
     */
    function createNote(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[4] calldata pubSignals
    ) external nonReentrant {
        uint256 nullifierHash = pubSignals[0];
        bytes32 newCommitment = bytes32(pubSignals[1]);
        bytes32 encryptedAmount = bytes32(pubSignals[2]);
        bytes32 root = bytes32(pubSignals[3]);

        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();

        // Verify the ZK proof. The amount is a PRIVATE input —
        // the EVM verifies the proof without ever seeing it.
        if (!verifier.verifyProof(proofA, proofB, proofC, pubSignals)) {
            revert InvalidProof();
        }

        // Mark old note as spent (CEI).
        nullifierHashes[nullifierHash] = true;

        // Insert new note into the Merkle tree.
        bytes32 newRoot = _insert(uint256(newCommitment));

        emit NoteCreated(newCommitment, encryptedAmount, nullifierHash, newRoot);
    }

    // ─── Seed Note (initial deposit into the note system) ───────
    /**
     * @notice Seed the first note into the system. This is the
     *         "deposit" equivalent — but it does NOT lock USDC.
     *         It simply inserts a commitment into the Merkle tree
     *         so the note system has a starting state.
     * @dev    Anyone can seed a note. The commitment is computed
     *         off-chain as Poseidon(nullifier, secret). The amount
     *         is NOT stored on-chain — only the commitment hash.
     */
    function seedNote(bytes32 commitment) external nonReentrant {
        bytes32 newRoot = _insert(uint256(commitment));
        emit NoteCreated(commitment, bytes32(0), 0, newRoot);
    }

    // ─── Merkle Tree (same pattern as PrivacyPool.sol) ──────────
    function _insert(uint256 leaf) internal returns (bytes32) {
        uint32 index = nextLeafIndex;
        if (index >= 2 ** MERKLE_DEPTH) revert MerkleTreeFull();

        uint256 current = leaf;
        for (uint32 l = 0; l < MERKLE_DEPTH; l++) {
            bool isRight = (index >> l) & 1 == 1;
            if (isRight) {
                bytes32 left = filledSubtrees[l];
                filledSubtrees[l] = zeros[l];
                current = PoseidonT3.poseidon(uint256(left), current);
            } else {
                filledSubtrees[l] = bytes32(current);
                current = PoseidonT3.poseidon(current, uint256(zeros[l]));
            }
        }
        nextLeafIndex = index + 1;
        roots[index % ROOT_HISTORY_SIZE] = bytes32(current);
        currentRoot = bytes32(current);
        return bytes32(current);
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == currentRoot) return true;
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (roots[i] == root) return true;
        }
        return false;
    }

    function currentRootOf() external view returns (bytes32) {
        return currentRoot;
    }

    function noteCount() external view returns (uint32) {
        return nextLeafIndex;
    }

    receive() external payable {}
}
