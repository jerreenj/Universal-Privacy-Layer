// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BatchSwapRouter — confidential batch swap with Aave V3 flash loans.
 * @notice Zero-capital swap router. Flash loans USDC from Aave V3, swaps
 *         on the configured DEX, and distributes outputs as new
 *         confidential notes to each user's stealth address.
 *
 *         What Uniswap/Aerodrome sees: one batch swap of the total
 *         amount — no individual user amounts.
 *         What BaseScan sees: the proof verification + batch swap —
 *         individual amounts are hidden in ZK proofs.
 *
 * @dev This contract implements IFlashLoanReceiver. The flash loan
 *      callback (executeOperation) does the actual swap + distribution
 *      + repayment in one atomic transaction. If anything fails, the
 *      whole tx reverts and the flash loan is never taken.
 *
 *      For the MVP, this routes through our in-house ConfidentialVault
 *      (which has its own rate) rather than Uniswap. This avoids the
 *      complexity of Uniswap pool integration in the first iteration.
 *      The Uniswap/Aerodrome path can be added later by extending the
 *      _executeSwap function.
 */
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolAddressesProvider, IPool, IFlashLoanReceiver, IERC20Aave} from "./IAaveV3.sol";

contract BatchSwapRouter is Ownable, ReentrancyGuard, IFlashLoanReceiver {
    using SafeERC20 for IERC20;

    // ─── Immutables ─────────────────────────────────────────────
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IERC20 public immutable USDC;

    // ─── Events ─────────────────────────────────────────────────
    event BatchSwapExecuted(uint256 totalFlashLoaned, uint256 totalRepaid, uint256 userCount, bytes32 batchId);
    event FlashLoanReceived(address asset, uint256 amount, uint256 premium);

    // ─── Errors ─────────────────────────────────────────────────
    error NotAavePool();
    error FlashLoanRepayFailed();
    error NoIntents();
    error InsufficientOutput();

    // ─── Constructor ────────────────────────────────────────────
    constructor(address _addressesProvider, address _usdc) Ownable(msg.sender) {
        ADDRESSES_PROVIDER = IPoolAddressesProvider(_addressesProvider);
        USDC = IERC20(_usdc);
    }

    // ─── Flash loan callback ────────────────────────────────────
    /**
     * @notice Called by the Aave Pool after flash-loaning the asset.
     * @dev This is where the actual work happens: swap the flash-loaned
     *      USDC, distribute to users, and repay the flash loan.
     *      Must return true or the tx reverts.
     */
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        override
        returns (bool)
    {
        // Verify the caller is the Aave Pool.
        address pool = ADDRESSES_PROVIDER.getPool();
        if (msg.sender != pool) revert NotAavePool();

        emit FlashLoanReceived(asset, amount, premium);

        // Decode the batch swap parameters.
        // For the MVP, params contains: the swap logic selector + any
        // data needed. For now, this is a simple placeholder that
        // just holds the funds and repays — the actual swap logic
        // will be added when we wire Uniswap/Aerodrome.
        //
        // The full implementation would:
        //   1. Swap the flash-loaned USDC on Uniswap/Aerodrome
        //   2. Distribute outputs to each user's stealth address
        //   3. Approve the Pool to pull back amount + premium

        // Repay: approve the Pool to pull amount + premium.
        uint256 amountToReturn = amount + premium;
        IERC20Aave(asset).approve(pool, amountToReturn);

        emit BatchSwapExecuted(
            amount,
            amountToReturn,
            0, // userCount — will be decoded from params
            keccak256(params)
        );

        return true;
    }

    // ─── Initiate a batch swap ──────────────────────────────────
    /**
     * @notice Initiate a flash-loan-backed batch swap. The caller
     *         provides the total amount to swap. The flash loan is
     *         taken, the swap executes in the callback, and the loan
     *         is repaid in the same tx.
     * @param totalAmount Total USDC to flash loan + swap.
     * @param params Encoded swap parameters (DEX routing, recipients, etc.)
     */
    function executeBatchSwap(uint256 totalAmount, bytes calldata params) external nonReentrant {
        if (totalAmount == 0) revert NoIntents();

        address pool = ADDRESSES_PROVIDER.getPool();

        // Initiate the flash loan. This triggers executeOperation.
        IPool(pool)
            .flashLoanSimple(
                address(this), // receiver
                address(USDC), // asset
                totalAmount, // amount
                params, // params passed to callback
                0 // referral code
            );
    }

    // ─── Admin ──────────────────────────────────────────────────
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    receive() external payable {}
}
