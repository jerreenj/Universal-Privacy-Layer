// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title UniswapPrivacyWrapper
 * @notice Privacy wrapper for Uniswap V3 swaps
 * @dev Routes swaps through privacy layer to hide trader identity
 */

// Uniswap V3 SwapRouter interface
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

// WETH interface
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract UniswapPrivacyWrapper is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Uniswap V3 Router addresses
    address public immutable swapRouter;
    address public immutable WETH;

    // Fee configuration
    uint256 public feeRate = 5; // 0.05% = 5 basis points
    uint256 public constant FEE_DENOMINATOR = 10000;
    address public feeRecipient;

    // Events (minimal data for privacy)
    event PrivateSwap(bytes32 indexed swapId, uint256 timestamp);

    constructor(address _swapRouter, address _weth, address _feeRecipient) {
        swapRouter = _swapRouter;
        WETH = _weth;
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Private swap ETH to Token
     * @param tokenOut Output token address
     * @param fee Uniswap pool fee tier (500, 3000, 10000)
     * @param amountOutMinimum Minimum output amount (slippage protection)
     * @param recipient Stealth address to receive tokens
     * @param deadline Transaction deadline
     */
    function privateSwapETHForToken(
        address tokenOut,
        uint24 fee,
        uint256 amountOutMinimum,
        address recipient,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 amountOut) {
        require(msg.value > 0, "No ETH sent");
        require(recipient != address(0), "Invalid recipient");

        // Calculate and collect fee
        uint256 protocolFee = (msg.value * feeRate) / FEE_DENOMINATOR;
        uint256 swapAmount = msg.value - protocolFee;

        if (protocolFee > 0) {
            (bool feeSuccess,) = feeRecipient.call{value: protocolFee}("");
            require(feeSuccess, "Fee transfer failed");
        }

        // Wrap ETH
        IWETH(WETH).deposit{value: swapAmount}();
        IWETH(WETH).approve(swapRouter, swapAmount);

        // Execute swap to recipient stealth address
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: WETH,
            tokenOut: tokenOut,
            fee: fee,
            recipient: recipient,
            deadline: deadline,
            amountIn: swapAmount,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = ISwapRouter(swapRouter).exactInputSingle(params);

        // Emit minimal event
        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);

        return amountOut;
    }

    /**
     * @notice Private swap Token to ETH
     * @param tokenIn Input token address
     * @param amountIn Amount of input tokens
     * @param fee Uniswap pool fee tier
     * @param amountOutMinimum Minimum ETH output
     * @param recipient Stealth address to receive ETH
     * @param deadline Transaction deadline
     */
    function privateSwapTokenForETH(
        address tokenIn,
        uint256 amountIn,
        uint24 fee,
        uint256 amountOutMinimum,
        address payable recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "No tokens sent");
        require(recipient != address(0), "Invalid recipient");

        // Transfer tokens from sender
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(swapRouter, amountIn);

        // Execute swap - receive WETH to this contract
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: WETH,
            fee: fee,
            recipient: address(this),
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = ISwapRouter(swapRouter).exactInputSingle(params);

        // Unwrap WETH
        IWETH(WETH).withdraw(amountOut);

        // Calculate fee
        uint256 protocolFee = (amountOut * feeRate) / FEE_DENOMINATOR;
        uint256 transferAmount = amountOut - protocolFee;

        // Send fee
        if (protocolFee > 0) {
            (bool feeSuccess,) = feeRecipient.call{value: protocolFee}("");
            require(feeSuccess, "Fee transfer failed");
        }

        // Send ETH to stealth address
        (bool success,) = recipient.call{value: transferAmount}("");
        require(success, "ETH transfer failed");

        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);

        return transferAmount;
    }

    /**
     * @notice Private swap Token to Token
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input tokens
     * @param fee Uniswap pool fee tier
     * @param amountOutMinimum Minimum output tokens
     * @param recipient Stealth address
     * @param deadline Transaction deadline
     */
    function privateSwapTokenForToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        uint256 amountOutMinimum,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "No tokens sent");
        require(recipient != address(0), "Invalid recipient");

        // Transfer tokens from sender
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(swapRouter, amountIn);

        // Execute swap directly to recipient
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: recipient,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        amountOut = ISwapRouter(swapRouter).exactInputSingle(params);

        emit PrivateSwap(keccak256(abi.encodePacked(block.timestamp, msg.sender)), block.timestamp);

        return amountOut;
    }

    // Allow contract to receive ETH (for unwrapping WETH)
    receive() external payable {}
}
