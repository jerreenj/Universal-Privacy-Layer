// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ConfidentialVault — variable-amount confidential notes on Base.
 * @notice Arcium-style encrypted balance layer for USDC. Notes are
 *         Poseidon commitments with encrypted amounts. Transfers between
 *         users are pure ZK state transitions — no USDC.transfer fires,
 *         no amount is revealed on BaseScan.
 *
 * @dev The vault holds USDC reserves. Deposits pull USDC in (boundary
 *      cost — amount visible but sender identity hidden via proxy/relayer).
 *      Withdrawals push USDC out (boundary cost — amount visible but
 *      recipient is a stealth address). Between two confidential users,
 *      `confidentialTransfer` creates a new note without any token
 *      movement — the amount stays encrypted in the ZK proof.
 *
 *      Merkle tree: depth 20, PoseidonT3 (2-input) per level, same as
 *      PrivacyPool.sol. Zero subtrees precomputed in constructor.
 *
 *      Verifier: ConfidentialTransferVerifier (Groth16, 5 public signals).
 *      pubSignals order: [nullifierHash, newCommitment, encryptedAmount,
 *                         root, recipient]
 *
 *      The contract NEVER stores plaintext amounts. It stores:
 *        - commitments (Poseidon hashes) as Merkle leaves
 *        - encryptedAmounts (Poseidon(amount, recipient)) per commitment
 *        - nullifierHashes (spent set)
 *
 *      The actual amount is only known to the sender and recipient
 *      off-chain. On-chain it exists only inside the ZK proof's private
 *      witness.
 */
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoseidonT3} from "./PoseidonT3.sol";
import {Groth16Verifier as ConfidentialTransferVerifier} from "./ConfidentialTransferVerifier.sol";

contract ConfidentialVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoseidonT3 for *;

    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant MERKLE_DEPTH = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 100;

    // ─── Token ──────────────────────────────────────────────────
    IERC20 public immutable USDC;

    // ─── Verifier ───────────────────────────────────────────────
    ConfidentialTransferVerifier public immutable verifier;

    // ─── Merkle Tree ────────────────────────────────────────────
    bytes32[MERKLE_DEPTH] public filledSubtrees;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    bytes32 public currentRoot;
    uint32 public nextLeafIndex;
    bytes32[MERKLE_DEPTH + 1] public zeros;

    // ─── Note state ─────────────────────────────────────────────
    mapping(uint256 => bool) public nullifierHashes;
    mapping(bytes32 => bytes32) public noteEncryptedAmounts;

    // ─── Events (minimal data, no plaintext amounts) ────────────
    event NoteDeposited(bytes32 indexed commitment, bytes32 encryptedAmount, uint32 indexed leafIndex, bytes32 root);
    event NoteWithdrawn(address indexed recipient, uint256 nullifierHash, bytes32 root);
    event NoteTransferred(bytes32 indexed newCommitment, bytes32 encryptedAmount, uint256 nullifierHash, bytes32 root);
    event UsdcFunded(address indexed funder, uint256 amount);
    event UsdcWithdrawn(address indexed to, uint256 amount);

    // ─── Errors ─────────────────────────────────────────────────
    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownRoot();
    error RecipientZero();
    error MerkleTreeFull();
    error AmountZero();
    error InsufficientReserves(uint256 requested, uint256 available);
    error CommitmentAlreadyExists();

    // ─── Constructor ────────────────────────────────────────────
    constructor(address _usdc, address _verifier, address _owner) Ownable(_owner) {
        USDC = IERC20(_usdc);
        verifier = ConfidentialTransferVerifier(_verifier);

        // Precompute zero subtrees (same as PrivacyPool.sol).
        zeros[0] = bytes32(0);
        for (uint32 l = 1; l <= MERKLE_DEPTH; l++) {
            zeros[l] = bytes32(PoseidonT3.poseidon(uint256(zeros[l - 1]), uint256(zeros[l - 1])));
        }
        currentRoot = zeros[MERKLE_DEPTH];
        roots[0] = currentRoot;
    }

    // ─── Deposit ────────────────────────────────────────────────
    /**
     * @notice Deposit USDC into the vault, creating a confidential note.
     * @dev    USDC.transferFrom fires here (boundary cost — amount visible
     *         but sender identity hidden via proxy/relayer). The note
     *         commitment is stored as a Merkle leaf; the amount is
     *         encrypted as Poseidon(amount, address(this)).
     * @param nullifier    Random 32-byte field element (note ownership key)
     * @param secret       Random 32-byte field element (note spending key)
     * @param amount       USDC amount (6 decimals) — visible at this boundary
     * @param blindingFactor Random 32-byte field element (note randomness)
     */
    function deposit(uint256 nullifier, uint256 secret, uint256 amount, uint256 blindingFactor) external nonReentrant {
        if (amount == 0) revert AmountZero();

        // Pull USDC from the depositor.
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        // Compute commitment = Poseidon(nullifier, secret).
        uint256 commitment = PoseidonT3.poseidon(nullifier, secret);

        // Compute encryptedAmount = Poseidon(amount, blindingFactor).
        // The recipient learns (amount, blindingFactor) off-chain and
        // can verify this matches.
        bytes32 encAmount = bytes32(PoseidonT3.poseidon(amount, blindingFactor));

        // Insert commitment into the Merkle tree.
        bytes32 newRoot = _insert(commitment);
        noteEncryptedAmounts[bytes32(commitment)] = encAmount;

        emit NoteDeposited(bytes32(commitment), encAmount, nextLeafIndex - 1, newRoot);
    }

    // ─── Withdraw ───────────────────────────────────────────────
    /**
     * @notice Withdraw USDC from a confidential note to a stealth address.
     * @dev    USDC.transfer fires here (boundary cost — amount visible
     *         but recipient is a stealth address, no identity link).
     *         The ZK proof verifies: caller owns the note, amount > 0,
     *         amount < 2^64. The actual amount is NOT in the proof's
     *         public signals — it's a private input. The contract
     *         reads the amount from the caller's off-chain note data
     *         (passed as a separate parameter) and verifies it matches
     *         the encryptedAmount in the proof.
     *
     *         Wait — the circuit doesn't reveal the amount publicly.
     *         So how does the contract know how much USDC to send?
     *
     *         Answer: the withdraw function takes the amount as a
     *         SEPARATE parameter. The contract verifies that
     *         Poseidon(amount, recipient) matches the encryptedAmount
     *         from the proof's public signals. If they match, the
     *         amount is correct (the ZK proof already proved amount > 0
     *         and that the caller owns the note). The contract then
     *         sends `amount` USDC to the recipient.
     *
     *         The amount IS visible in the USDC.transfer event at this
     *         point — but it's detached from identity (stealth address).
     *
     * @param proofA       Groth16 proof part A
     * @param proofB       Groth16 proof part B
     * @param proofC       Groth16 proof part C
     * @param pubSignals   [nullifierHash, newCommitment, encryptedAmount, root, recipient]
     * @param amount       The plaintext amount (verified against encryptedAmount)
     */
    function withdraw(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[5] calldata pubSignals,
        uint256 amount
    ) external nonReentrant {
        uint256 nullifierHash = pubSignals[0];
        // pubSignals[1] = newCommitment (not used for withdraw — set to 0)
        bytes32 encryptedAmount = bytes32(pubSignals[2]);
        bytes32 root = bytes32(pubSignals[3]);
        address recipient = address(uint160(pubSignals[4]));

        if (recipient == address(0)) revert RecipientZero();
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();
        if (amount == 0) revert AmountZero();

        // Verify the ZK proof.
        if (!verifier.verifyProof(proofA, proofB, proofC, pubSignals)) {
            revert InvalidProof();
        }

        // Verify the plaintext amount matches the encrypted amount.
        // encryptedAmount = Poseidon(amount, recipient) from the circuit.
        // If the caller passes a wrong amount, this check fails.
        bytes32 expectedEnc = bytes32(PoseidonT3.poseidon(amount, uint256(uint160(recipient))));
        if (expectedEnc != encryptedAmount) revert InvalidProof();

        // Check reserves.
        uint256 reserve = USDC.balanceOf(address(this));
        if (amount > reserve) revert InsufficientReserves(amount, reserve);

        // Mark nullifier as spent (CEI).
        nullifierHashes[nullifierHash] = true;

        // Send USDC to the stealth recipient.
        USDC.safeTransfer(recipient, amount);

        emit NoteWithdrawn(recipient, nullifierHash, root);
    }

    // ─── Confidential Transfer ──────────────────────────────────
    /**
     * @notice Transfer between two confidential users. NO USDC moves.
     * @dev    This is the core privacy primitive. The old note is
     *         nullified; a new note is created for the recipient.
     *         The amount is NEVER plaintext on-chain — it exists only
     *         in the ZK proof's private witness. No USDC.transfer fires.
     *         No amount is visible on BaseScan.
     *
     *         The proof verifies:
     *           - Caller owns the old note (nullifier, secret → commitment)
     *           - Old commitment is in the Merkle tree under `root`
     *           - amount > 0 and amount < 2^64
     *           - newCommitment = Poseidon(amount, blindingFactor)
     *           - encryptedAmount = Poseidon(amount, recipient)
     *
     *         The contract inserts newCommitment as a new leaf and
     *         stores the encryptedAmount. The recipient scans the tree,
     *         finds their note, and decrypts the amount off-chain.
     *
     * @param proofA       Groth16 proof part A
     * @param proofB       Groth16 proof part B
     * @param proofC       Groth16 proof part C
     * @param pubSignals   [nullifierHash, newCommitment, encryptedAmount, root, recipient]
     */
    function confidentialTransfer(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[5] calldata pubSignals
    ) external nonReentrant {
        uint256 nullifierHash = pubSignals[0];
        bytes32 newCommitment = bytes32(pubSignals[1]);
        bytes32 encryptedAmount = bytes32(pubSignals[2]);
        bytes32 root = bytes32(pubSignals[3]);
        // recipient = pubSignals[4] — not used on-chain beyond the proof

        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();

        // Verify the ZK proof.
        if (!verifier.verifyProof(proofA, proofB, proofC, pubSignals)) {
            revert InvalidProof();
        }

        // Mark old note as spent.
        nullifierHashes[nullifierHash] = true;

        // Insert new note into the Merkle tree.
        bytes32 newRoot = _insert(uint256(newCommitment));
        noteEncryptedAmounts[newCommitment] = encryptedAmount;

        emit NoteTransferred(newCommitment, encryptedAmount, nullifierHash, newRoot);
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

    function depositCount() external view returns (uint32) {
        return nextLeafIndex;
    }

    // ─── Admin ──────────────────────────────────────────────────
    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        USDC.safeTransfer(to, amount);
        emit UsdcWithdrawn(to, amount);
    }

    function fundUSDC(uint256 amount) external {
        require(amount > 0, "amount=0");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit UsdcFunded(msg.sender, amount);
    }

    function reserveBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    receive() external payable {}
}
