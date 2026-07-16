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

    event NoteSettled(uint256 indexed nullifierHash, address recipient, uint256 amount);
    event USDCFunded(uint256 amount);

    constructor(address _verifier) Ownable(msg.sender) {
        verifier = _verifier;
    }

    /**
     * @notice Settle a confidential note — redeem it for real USDC.
     *         Called by the relayer. The relayer fronts the USDC.
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
        uint256 nullifierHash = pubSignals[0];
        uint256 amount = pubSignals[1];

        // Check not already settled
        require(!settledNullifiers[nullifierHash], "Already settled");

        // Verify the ZK proof
        (bool valid) = IVerifier(verifier).verifyProof(proofA, proofB, proofC, pubSignals);
        require(valid, "Invalid proof");

        // Mark as settled (CEI pattern)
        settledNullifiers[nullifierHash] = true;

        // Transfer USDC to recipient
        // The relayer (or this contract) must hold enough USDC.
        // The contract is funded by the owner (who collects USDC
        // from the note creation flow).
        (bool success,) = USDC.call(abi.encodeWithSelector(0xa9059cbb, recipient, amount));
        require(success, "USDC transfer failed");

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
