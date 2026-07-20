// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Groth16Verifier} from "./Verifier.sol";
import {PoseidonT3} from "./PoseidonT3.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PrivacyPool (Multi-Denomination, Phase 4.1)
 * @notice UPL ZK privacy pool on Base. Same Tornado-style semantics as the
 *         single-denom P3 contract but **parameterised over many
 *         denominations**: each registered denomination owns its own
 *         incremental Poseidon Merkle tree + ring buffer of recent roots.
 *         The double-spend guard (nullifierHashes) is global across
 *         denominations — a note spent on any pool cannot be replayed.
 *
 * @dev Why the global spent set:
 *      A note = (nullifier, secret, commitment). The cryptographic obligation
 *      the proof carries is "I know (nullifier, secret) such that
 *      commitment = Poseidon(nullifier, secret) is a leaf under root R and
 *      nullifierHash = Poseidon(nullifier)" — this is denomination-agnostic.
 *      Allowing the same note to withdraw twice across two different pools
 *      would let an attacker double the payout. So a single global
 *      `nullifierHashes` set blocks a note everywhere once it is spent once.
 *
 *      Pull the denom-set from one tree-of-trees via the root (the
 *      `withdraw` calldata carries `root`; we look it up across all
 *      denom trees' ring buffers to find the matching amount to pay out).
 *
 *      Pre-existing P3 tests: the old `denomination` public immutable is
 *      gone. The constructor now accepts `initialDenominations[]`; tests
 *      that previously `deploy(verifier, 0.1e18)` should now
 *      `deploy(verifier, [_denom = 0.1e18])`. The `deposit(bytes32)` sig
 *      is now `deposit(bytes32 commitment, uint256 denomination)` — a
 *      mandatory denom param.
 */
contract PrivacyPool is Ownable, ReentrancyGuard {
    using PoseidonT3 for *;

    uint256 public constant MERKLE_DEPTH = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 100;

    Groth16Verifier public immutable verifier;

    // ─── Fee configuration ──────────────────────────────────────────────────
    // 100 basis points = 1% withdrawal fee. Owner can reduce via setFeeBps().
    // Capped at MAX_FEE_BPS = 100 (1%) — cannot be raised above 1%.
    uint256 private _feeBps = 100;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_BPS = 100;

    // ─── Revenue wallet ─────────────────────────────────────────────────────
    // Address where withdrawal fees are sent. Set by owner.
    address public revenueWallet;

    // ─── Per-denomination tree state ─────────────────────────────────────
    struct DenomTree {
        bytes32[20] filledSubtrees;
        bytes32[100] roots; // ring buffer of recent roots
        bytes32 currentRoot;
        uint32 nextLeafIndex;
    }

    mapping(uint256 => DenomTree) public denomTrees;
    mapping(uint256 => bool) public denominationEnabled;
    uint256[] public denominationList;

    // ─── Precomputed zero subtrees ─────────────────────────────────────────
    bytes32[MERKLE_DEPTH + 1] public zeros;

    // ─── Global spent set ─────────────────────────────────────────────────
    mapping(uint256 => bool) public nullifierHashes;

    // ─── Events ────────────────────────────────────────────────────────────
    event DenominationAdded(uint256 indexed denomination);
    event Deposit(bytes32 indexed commitment, uint256 indexed denomination, uint32 indexed leafIndex, bytes32 root);
    event Withdrawal(address indexed recipient, uint256 nullifierHash, bytes32 root);
    event Sweep(address indexed to, uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event RevenueWalletUpdated(address indexed oldWallet, address indexed newWallet);

    // ─── Errors ────────────────────────────────────────────────────────────
    error MustPayExactDenomination();
    error MerkleTreeFull();
    error UnknownRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error TransferFailed();
    error RecipientZero();
    error DenominationNotEnabled(uint256 denomination);
    error ZeroDenomination();
    error FeeExceedsMaximum();
    error FeeTransferFailed();
    error RevenueWalletNotSet();

    constructor(address _verifier, uint256[] memory _initialDenominations) Ownable(msg.sender) {
        if (_verifier == address(0)) revert RecipientZero();
        // Re-cast to Groth16Verifier at construction time. The runtime ABI the
        // verifier contract uses (verifyProof) is the same for every
        // implementation (snarkjs-generated + MockGroth16Verifier), so trusting
        // the supplied address is safe.
        verifier = Groth16Verifier(_verifier);

        // Precompute zero subtrees (level 0 = empty leaf = 0).
        zeros[0] = bytes32(0);
        for (uint256 l = 1; l <= MERKLE_DEPTH; l++) {
            zeros[l] = bytes32(PoseidonT3.poseidon(uint256(zeros[l - 1]), uint256(zeros[l - 1])));
        }

        // Register each initial denomination: seeds its tree with the empty
        // root history. Idempotent if duplicate denominations are passed in.
        for (uint256 i = 0; i < _initialDenominations.length; i++) {
            _addDenominationInternal(_initialDenominations[i]);
        }
    }

    // ─── Owner admin: add a denomination ──────────────────────────────────
    /**
     * @notice Register a new denomination. Owner-only. Idempotent.
     * @dev After this call, `deposit(commitment, denomination)` will accept
     *      deposits at exactly `denomination` wei. Each denomination owns its
     *      own Merkle tree + root history.
     */
    function addDenomination(uint256 denomination) external onlyOwner {
        _addDenominationInternal(denomination);
    }

    function _addDenominationInternal(uint256 denomination) internal {
        if (denomination == 0) revert ZeroDenomination();
        if (denominationEnabled[denomination]) return;
        denominationEnabled[denomination] = true;
        denominationList.push(denomination);

        DenomTree storage t = denomTrees[denomination];
        for (uint256 l = 0; l < MERKLE_DEPTH; l++) {
            t.filledSubtrees[l] = zeros[l];
        }
        t.currentRoot = zeros[MERKLE_DEPTH];
        // Seed the root history with the empty root so a future user can
        // prove + withdraw before any deposit has happened.
        t.roots[0] = t.currentRoot;

        emit DenominationAdded(denomination);
    }

    // ─── Owner admin: fee & revenue wallet ───────────────────────────────────
    /**
     * @notice Set the revenue wallet address. Owner-only. Fee is sent here on
     *         every withdrawal. Must be set before withdrawals are allowed.
     * @param newWallet The address that will receive withdrawal fees.
     */
    function setRevenueWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert RecipientZero();
        address oldWallet = revenueWallet;
        revenueWallet = newWallet;
        emit RevenueWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Update the withdrawal fee. Owner-only. Can only REDUCE the fee,
     *         never increase it above MAX_FEE_BPS (100 bps = 1%).
     * @param newFeeBps New fee in basis points (must be <= MAX_FEE_BPS).
     */
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeExceedsMaximum();
        uint256 oldRate = _feeBps;
        _feeBps = newFeeBps;
        emit FeeRateUpdated(oldRate, newFeeBps);
    }

    /// @notice Read the current withdrawal fee in basis points.
    function feeBps() external view returns (uint256) {
        return _feeBps;
    }

    // ─── Deposit ──────────────────────────────────────────────────────────
    /**
     * @notice Deposit `denomination` wei into the pool, committing
     *         `commitment = Poseidon(nullifier, secret)` (computed off-chain)
     *         as a new leaf in the chosen denomination's Merkle tree.
     *         Emits (commitment, denomination, leafIndex, newRoot).
     * @param commitment Leaf = Poseidon(nullifier, secret). The depositor
     *        keeps the note private; only `commitment` is on-chain.
     * @param denomination Whitelisted deposit amount (wei). Must equal msg.value.
     */
    function deposit(bytes32 commitment, uint256 denomination) external payable nonReentrant {
        if (!denominationEnabled[denomination]) {
            revert DenominationNotEnabled(denomination);
        }
        if (msg.value != denomination) revert MustPayExactDenomination();

        DenomTree storage t = denomTrees[denomination];
        uint32 leafIndex = t.nextLeafIndex;
        if (leafIndex >= 2 ** MERKLE_DEPTH) revert MerkleTreeFull();

        bytes32 newRoot = _insert(uint256(commitment), t);

        uint256 slot = uint256(leafIndex) % ROOT_HISTORY_SIZE;
        t.roots[slot] = newRoot;
        t.currentRoot = newRoot;

        emit Deposit(commitment, denomination, leafIndex, newRoot);
    }

    // ─── Withdraw ──────────────────────────────────────────────────────────
    /**
     * @notice Withdraw to `recipient` by proving — without revealing the
     *         deposit — knowledge of `(nullifier, secret, merklePath)` whose
     *         commitment is a leaf under `root` in *some* denomination's
     *         tree, and revealing `nullifierHash = Poseidon(nullifier)`.
     * @param pubSignals `[nullifierHash, root, recipient]` — public signals in
     *        the same order as `withdraw.circom` declares public outputs +
     *        inputs (snarkjs order: outputs first).
     */
    function withdraw(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[3] calldata pubSignals // [nullifierHash, root, recipient]
    ) external nonReentrant {
        uint256 nullifierHash = pubSignals[0];
        bytes32 root = bytes32(pubSignals[1]);
        address recipient = address(uint160(pubSignals[2]));

        if (recipient == address(0)) revert RecipientZero();
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();

        if (!verifier.verifyProof(proofA, proofB, proofC, pubSignals)) {
            revert InvalidProof();
        }

        // Check-effects-interactions: mark spent BEFORE the external call.
        nullifierHashes[nullifierHash] = true;

        // The amount paid is determined by which denom's recent-root ring
        // buffer contains the public-signal root. Linear scan — few denoms
        // in practice (typically <12), ROOT_HISTORY_SIZE is 100.
        uint256 denomination = _findDenomByRoot(root);
        if (denomination == 0) revert UnknownRoot(); // safety — root vanished mid-call

        // ─── Fee collection (1% to revenue wallet) ─────────────────────────
        if (revenueWallet == address(0)) revert RevenueWalletNotSet();
        
        // Calculate fee: 1% of denomination (100 bps / 10000 = 1%)
        uint256 fee = (denomination * _feeBps) / FEE_DENOMINATOR;
        uint256 recipientAmount = denomination - fee;

        // Send fee to revenue wallet first (separate from recipient transfer)
        if (fee > 0) {
            (bool feeOk,) = payable(revenueWallet).call{value: fee}("");
            if (!feeOk) revert FeeTransferFailed();
        }

        // Send remainder to recipient
        (bool ok,) = recipient.call{value: recipientAmount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawal(recipient, nullifierHash, root);
    }

    // ─── Views ────────────────────────────────────────────────────────────
    /// @notice Whether `root` is currently in any denom's recent-roots window.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        for (uint256 i = 0; i < denominationList.length; i++) {
            DenomTree storage t = denomTrees[denominationList[i]];
            for (uint256 j = 0; j < ROOT_HISTORY_SIZE; j++) {
                if (t.roots[j] == root) return true;
            }
        }
        return false;
    }

    /// @notice Index of the next leaf that would be inserted in `denomination`'s tree.
    function depositCount(uint256 denomination) external view returns (uint32) {
        if (!denominationEnabled[denomination]) {
            revert DenominationNotEnabled(denomination);
        }
        return denomTrees[denomination].nextLeafIndex;
    }

    /// @notice The current Merkle root for a denomination's pool.
    function currentRootOf(uint256 denomination) external view returns (bytes32) {
        if (!denominationEnabled[denomination]) {
            revert DenominationNotEnabled(denomination);
        }
        return denomTrees[denomination].currentRoot;
    }

    /// @notice All registered denominations, in registration order.
    function getDenominationList() external view returns (uint256[] memory) {
        return denominationList;
    }

    /// @notice Whether `denomination` is currently enabled for deposits.
    function isDenominationEnabled(uint256 denomination) external view returns (bool) {
        return denominationEnabled[denomination];
    }

    // ─── Owner sweep ─────────────────────────────────────────────────────
    /**
     * @notice Sweep ETH accidentally sent to the contract (e.g. selfdestruct
     *         refund). Cannot sweep pool funds — only the EXCESS above the
     *         pool's locked balance across ALL denominations.
     */
    function sweep(address to) external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        uint256 totalLocked;
        for (uint256 i = 0; i < denominationList.length; i++) {
            uint256 d = denominationList[i];
            DenomTree storage t = denomTrees[d];
            totalLocked += uint256(t.nextLeafIndex) * d;
        }
        uint256 excess = balance > totalLocked ? balance - totalLocked : 0;
        if (excess > 0) {
            (bool ok,) = to.call{value: excess}("");
            if (!ok) revert TransferFailed();
            emit Sweep(to, excess);
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────
    function _findDenomByRoot(bytes32 root) internal view returns (uint256) {
        for (uint256 i = 0; i < denominationList.length; i++) {
            uint256 d = denominationList[i];
            DenomTree storage t = denomTrees[d];
            for (uint256 j = 0; j < ROOT_HISTORY_SIZE; j++) {
                if (t.roots[j] == root) return d;
            }
        }
        return 0;
    }

    /**
     * @dev Insert `leaf` into `t`'s tree, return the new root. Idempotent-
     *      proof: every level's left sibling is `t.filledSubtrees[l]` at start;
     *      right-branch resets the level to `zeros[l]` for the next deposit
     *      that reaches this level.
     */
    function _insert(uint256 leaf, DenomTree storage t) internal returns (bytes32) {
        uint32 index = t.nextLeafIndex;
        uint256 current = leaf;
        for (uint32 l = 0; l < MERKLE_DEPTH; l++) {
            bool isRight = (index >> l) & 1 == 1;
            if (isRight) {
                bytes32 left = t.filledSubtrees[l];
                t.filledSubtrees[l] = zeros[l];
                current = PoseidonT3.poseidon(uint256(left), current);
            } else {
                t.filledSubtrees[l] = bytes32(current);
                current = PoseidonT3.poseidon(current, uint256(zeros[l]));
            }
        }
        t.nextLeafIndex = index + 1;
        return bytes32(current);
    }

    receive() external payable {}
}
