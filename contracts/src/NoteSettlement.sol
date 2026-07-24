// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NoteSettlement — Redeem confidential notes for real USDC.
 *
 * The settlement step of the hidden amount system. A user who holds
 * a confidential note (created via ConfidentialNotes.sol) can redeem
 * it here for real USDC.
 *
 * Flow:
 *   1. User generates a spend proof (confidential_spend.circom):
 *      proves knowledge of (nullifier, secret) → nullifierHash + amount
 *   2. Relayer calls settle() with the proof + recipient address
 *   3. Contract verifies the proof
 *   4. Contract checks nullifierHash not already spent
 *   5. Contract transfers `amount` USDC to recipient
 *   6. Marks nullifierHash as spent
 *
 * Privacy:
 *   - The settlement tx shows the amount (unavoidable for ERC20)
 *   - But nullifierHash is a hash — can't be linked back to the
 *     note creation tx
 *   - The relayer is msg.sender, not the user
 *   - The recipient is a fresh stealth address
 *
 * The relayer fronts the USDC from its own balance. The note system
 * replenishes the relayer through the note creation flow (the USDC
 * that was "hidden" in the note is actually held by the relayer
 * during the note's lifetime).
 */
contract NoteSettlement is Ownable, ReentrancyGuard {
    // The spend-proof verifier (Groth16, 2 public signals)
    address public immutable verifier;

    // USDC token
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Spent nullifier set — prevents double-settlement
    mapping(uint256 => bool) public settledNullifiers;

    // ─── Fee configuration ──────────────────────────────────────────────────
    // 100 basis points = 1% settlement fee. Owner can reduce via setFeeBps().
    // Capped at MAX_FEE_BPS = 100 (1%) — cannot be raised above 1%.
    uint256 private _feeBps = 100;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_BPS = 100;

    // ─── Revenue wallet ─────────────────────────────────────────────────────
    // Address where settlement fees are sent. Set by owner.
    address public revenueWallet;

    event NoteSettled(uint256 indexed nullifierHash, address recipient, uint256 amount);
    event USDCFunded(uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event RevenueWalletUpdated(address indexed oldWallet, address indexed newWallet);

    constructor(address _verifier) Ownable(msg.sender) {
        verifier = _verifier;
    }

    // ─── Owner admin: fee & revenue wallet ───────────────────────────────────
    /**
     * @notice Set the revenue wallet address. Owner-only. Fee is sent here on
     *         every settlement. Must be set before settlements are allowed.
     * @param newWallet The address that will receive settlement fees.
     */
    function setRevenueWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Zero revenue wallet");
        address oldWallet = revenueWallet;
        revenueWallet = newWallet;
        emit RevenueWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Update the settlement fee. Owner-only. Can only REDUCE the fee,
     *         never increase it above MAX_FEE_BPS (100 bps = 1%).
     * @param newFeeBps New fee in basis points (must be <= MAX_FEE_BPS).
     */
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee exceeds maximum");
        uint256 oldRate = _feeBps;
        _feeBps = newFeeBps;
        emit FeeRateUpdated(oldRate, newFeeBps);
    }

    /// @notice Read the current settlement fee in basis points.
    function feeBps() external view returns (uint256) {
        return _feeBps;
    }

    /**
     * @notice Settle a confidential note — redeem it for real USDC.
     *         Called by the relayer. The relayer fronts the USDC.
     *         1% fee is sent to revenue wallet, 99% goes to recipient.
     *
     * @param proofA     Groth16 proof part A (2 elements)
     * @param proofB     Groth16 proof part B (2x2 elements)
     * @param proofC     Groth16 proof part C (2 elements)
     * @param pubSignals [nullifierHash, amount] — 2 public signals
     * @param recipient  Who receives the USDC (fresh stealth address)
     */
    function settle(
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[2] calldata pubSignals,
        address recipient
    ) external nonReentrant {
        require(revenueWallet != address(0), "Revenue wallet not set");

        uint256 nullifierHash = pubSignals[0];
        uint256 amount = pubSignals[1];

        // Check not already settled
        require(!settledNullifiers[nullifierHash], "Already settled");

        // Verify the ZK proof
        (bool valid) = IVerifier(verifier).verifyProof(proofA, proofB, proofC, pubSignals);
        require(valid, "Invalid proof");

        // Mark as settled (CEI pattern)
        settledNullifiers[nullifierHash] = true;

        // Calculate fee (1% of amount)
        uint256 fee = (amount * _feeBps) / FEE_DENOMINATOR;
        uint256 recipientAmount = amount - fee;

        // Transfer fee to revenue wallet
        if (fee > 0) {
            (bool feeSuccess,) = USDC.call(abi.encodeWithSelector(0xa9059cbb, revenueWallet, fee));
            require(feeSuccess, "Fee transfer failed");
        }

        // Transfer USDC to recipient (99% of amount)
        if (recipientAmount > 0) {
            (bool success,) = USDC.call(abi.encodeWithSelector(0xa9059cbb, recipient, recipientAmount));
            require(success, "USDC transfer failed");
        }

        emit NoteSettled(nullifierHash, recipient, amount);
    }

    /**
     * @notice Owner funds the settlement contract with USDC.
     *         The USDC comes from the note creation flow — when a
     *         user creates a note, the USDC is held by the relayer
     *         (or transferred here) until settlement.
     */
    function fundUSDC(uint256 amount) external onlyOwner {
        (bool success,) = USDC.call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount));
        require(success, "Fund failed");
        emit USDCFunded(amount);
    }

    /**
     * @notice Owner withdraws excess USDC (revenue or rebalancing).
     */
    function withdrawUSDC(uint256 amount) external onlyOwner {
        (bool success,) = USDC.call(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount));
        require(success, "Withdraw failed");
    }

    receive() external payable {}
}

interface IVerifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[2] calldata _pubSignals
    ) external view returns (bool);
}
