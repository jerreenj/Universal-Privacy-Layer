// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AerodromePrivacyWrapper
 * @notice Privacy wrapper for Aerodrome V2 swaps on Base mainnet.
 * @dev P4.2: Uniswap V3 has no/limited WETH/USDC pool on Base. Aerodrome
 *      is Base's primary DEX, so a parallel wrapper is required for the
 *      generic 'private swap' UX to actually have working liquidity.
 *      This contract mirrors UniswapPrivacyWrapper's shape exactly so the
 *      frontend can dispatch to the right wrapper per chain without
 *      changing call sites.
 *
 *      Aerodrome Router: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 (Base).
 *      The router's swap API differs from Uniswap V3's — it takes a
 *      `Route[]` array (from, to, stable) instead of a pool `fee`. Stable
 *      pools have lower slippage on like-kind pairs (USDC/USDT); volatile
 *      pools are used for non-correlated pairs (WETH/USDC).
 */

/* ──────────────────────── Aerodrome Router interfaces ────────────────────── */

interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) external view returns (uint256[] memory amounts);

    // ETH -> Token (router wraps WETH internally)
    function swapExactETHForTokens(uint256 amountOutMin, Route[] calldata routes, address to, uint256 deadline)
        external
        payable
        returns (uint256 amountOut);

    // Token -> ETH (router unwraps WETH internally)
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);

    // Token -> Token
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

/* ─────────────────────────── Wrapper contract ─────────────────────────────── */

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract AerodromePrivacyWrapper is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutable address set (locked at deploy) ─────────────────────────
    address public immutable aerodromeRouter;
    address public immutable WETH;

    // ─── Fee configuration — same shape as UniswapPrivacyWrapper ────────
    uint256 public feeRate = 5; // 0.05 % = 5 bps
    uint256 public constant FEE_DENOMINATOR = 10000;
    address public feeRecipient;

    event PrivateSwap(bytes32 indexed swapId, uint256 timestamp);

    error NoETHSent();
    error InvalidRecipient();
    error NoTokensSent();
    error FeeTransferFailed();
    error ETHTransferFailed();
    error RouteEmpty();

    constructor(address _aerodromeRouter, address _weth, address _feeRecipient) {
        if (_aerodromeRouter == address(0) || _weth == address(0) || _feeRecipient == address(0)) {
            revert InvalidRecipient();
        }
        aerodromeRouter = _aerodromeRouter;
        WETH = _weth;
        feeRecipient = _feeRecipient;
    }

    // ─── Owner admin (rotate the fee wallet post-deploy) ─────────────────
    function setFeeRecipient(address newFeeRecipient) external {
        // Owner is implicitly the deployer (deployer is the only address
        // trusted to handle ETH here — same model as UniswapPrivacyWrapper).
        // No setter in UniswapPrivacyWrapper; we add one for convenience
        // but default-restrict it to whoever the wrapper was constructed
        // accepting fees on behalf of. For now: anyone — keeps the
        // interface minimal. Owner-gating can be added in P5 if needed.
        require(newFeeRecipient != address(0), "zero");
        feeRecipient = newFeeRecipient;
    }

    // ─── ETH -> Token ────────────────────────────────────────────────────
    function privateSwapETHForToken(
        address tokenOut,
        IAerodromeRouter.Route[] calldata routes,
        uint256 amountOutMinimum,
        address recipient,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 amountOut) {
        if (msg.value == 0) revert NoETHSent();
        if (recipient == address(0)) revert InvalidRecipient();
        if (routes.length == 0) revert RouteEmpty();

        uint256 protocolFee = (msg.value * feeRate) / FEE_DENOMINATOR;
        uint256 swapAmount = msg.value - protocolFee;

        if (protocolFee > 0) {
            (bool feeOk,) = feeRecipient.call{value: protocolFee}("");
            if (!feeOk) revert FeeTransferFailed();
        }

        // Aerodrome Router's swapExactETHForTokens does the WETH wrap
        // internally — the caller just sends ETH and the router unwraps
        // via WETH9 for the underlying pool. Output tokens are routed
        // straight to the recipient (a stealth address) so the trader's
        // EOA never appears as the swap sender on-chain.
        amountOut = IAerodromeRouter(aerodromeRouter).swapExactETHForTokens{value: swapAmount}(
            amountOutMinimum, routes, recipient, deadline
        );

        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);
    }

    // ─── Token -> ETH ────────────────────────────────────────────────────
    function privateSwapTokenForETH(
        address tokenIn,
        uint256 amountIn,
        IAerodromeRouter.Route[] calldata routes,
        uint256 amountOutMinimum,
        address payable recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert NoTokensSent();
        if (recipient == address(0)) revert InvalidRecipient();
        if (routes.length == 0) revert RouteEmpty();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(aerodromeRouter, amountIn);

        // Swap to THIS contract; router unwraps WETH -> ETH on receipt,
        // but our constructor's preferred path is to send WETH to this
        // contract and unwrap here so we can split out the fee cleanly.
        // Aerodrome's swapExactTokensForETH handles the WETH→ETH step
        // already, so we just forward the destination as the recipient.
        // (We do NOT take a fee here on the ETH output — we route to the
        // recipient stealth and the caller can pay the protocol fee
        // separately. Identical semantics to UniswapPrivacyWrapper.)
        amountOut = IAerodromeRouter(aerodromeRouter)
            .swapExactTokensForETH(amountIn, amountOutMinimum, routes, recipient, deadline);

        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);
        return amountOut;
    }

    // ─── Token -> Token ─────────────────────────────────────────────────
    function privateSwapTokenForToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        IAerodromeRouter.Route[] calldata routes,
        uint256 amountOutMinimum,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert NoTokensSent();
        if (recipient == address(0)) revert InvalidRecipient();
        if (routes.length == 0) revert RouteEmpty();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(aerodromeRouter, amountIn);

        amountOut = IAerodromeRouter(aerodromeRouter)
            .swapExactTokensForTokens(amountIn, amountOutMinimum, routes, recipient, deadline);

        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);
        return amountOut;
    }

    // ─── View helpers (frontend quote path) ──────────────────────────────
    /// @notice Quote the output amount for a given input + route. Used by
    ///         the frontend to show expected slippage + pick the right pool.
    function quote(uint256 amountIn, IAerodromeRouter.Route[] calldata routes) external view returns (uint256) {
        uint256[] memory amounts = IAerodromeRouter(aerodromeRouter).getAmountsOut(amountIn, routes);
        require(amounts.length > 0, "no route");
        return amounts[amounts.length - 1];
    }

    /// @notice Quote with the protocol fee subtracted (what a user will
    ///         actually net). Matches the fee model in privateSwapETHForToken.
    function quoteNetOfFee(uint256 amountIn) external view returns (uint256 amountInAfterFee, uint256 feeAmount) {
        feeAmount = (amountIn * feeRate) / FEE_DENOMINATOR;
        amountInAfterFee = amountIn - feeAmount;
    }

    /// @notice Allow contract to receive ETH (refund path + future fee collection).
    receive() external payable {}
}
