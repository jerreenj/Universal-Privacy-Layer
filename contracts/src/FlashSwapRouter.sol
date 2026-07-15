// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FlashSwapRouter — Zero-capital USDC↔ETH swap via Morpho flash loans.
 *
 * FLOW (USDC → ETH):
 *   1. Relayer calls swapUSDCForETH (does permit + transferFrom first)
 *   2. FlashSwapRouter borrows WETH from Morpho (zero fee)
 *   3. Unwraps WETH → ETH, sends to recipient
 *   4. Swaps user's USDC → WETH on Curve to repay Morpho
 *   5. Surplus WETH stays in router = our revenue
 *
 * FLOW (ETH → USDC):
 *   1. Stealth sends ETH to this contract
 *   2. Relayer calls swapETHForUSDC
 *   3. Wraps ETH → WETH, flash loans USDC from Morpho
 *   4. Sends USDC to recipient, swaps WETH → USDC on Curve to repay
 *   5. Surplus USDC stays in router = our revenue
 *
 * PRIVACY: tx.from = relayer, not the user. User's wallet never appears.
 * CAPITAL: Zero. Morpho flash loan is free. Curve handles conversion.
 * REVENUE: 1% spread stays in router. Owner withdraws via withdrawRevenue().
 */
contract FlashSwapRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutable addresses ───────────────────────────────────────────────
    address public constant MORPHO = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address public constant CURVE_POOL = 0xF2EcC3A2dEFB4ECC1Ac510CBbc405a539A990BE4;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ─── Flash loan state ──────────────────────────────────────────────────
    // Set during the flash loan call, read in the callback.
    address private s_recipient;
    uint256 private s_flashAmount;
    uint8 private s_direction; // 0 = USDC→ETH, 1 = ETH→USDC

    // ─── Events ────────────────────────────────────────────────────────────
    event SwapExecuted(
        address indexed sender, address indexed recipient, uint8 direction, uint256 amountIn, uint256 amountOut
    );
    event RevenueWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── WETH9 interface ───────────────────────────────────────────────────
    IWETH9 private constant weth = IWETH9(payable(WETH));

    // ─── Curve interface (exchange(int128,int128,uint256,uint256)) ─────────
    ICurvePool private constant curve = ICurvePool(CURVE_POOL);

    // ─── USDC permit interface ─────────────────────────────────────────────
    IUSDCPermit private constant usdc = IUSDCPermit(USDC);

    constructor() Ownable(msg.sender) {}

    // ─── USDC → ETH ────────────────────────────────────────────────────────
    /**
     * @notice Swap USDC → ETH for a stealth user.
     *         Relayer calls this. Does permit + transferFrom, then
     *         flash loans WETH from Morpho, unwraps to ETH, sends to
     *         recipient, and repays Morpho with Curve-swapped WETH.
     *
     * @param stealth    User's stealth address (USDC holder)
     * @param recipient  Who receives the ETH (stealth address)
     * @param usdcAmount USDC amount (6 decimals)
     * @param v,r,s      EIP-2612 permit signature from stealth
     * @param deadline   Permit deadline
     * @param ethPrice   ETH price in USD × 1e6 (e.g. 2500000000 = $2500)
     */
    function swapUSDCForETH(
        address stealth,
        address payable recipient,
        uint256 usdcAmount,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 deadline,
        uint256 ethPrice
    ) external nonReentrant {
        require(usdcAmount > 0, "Zero amount");
        require(ethPrice > 0, "Zero price");

        // Step 1: permit + transferFrom — get USDC from stealth
        usdc.permit(stealth, address(this), usdcAmount, deadline, v, r, s);
        usdc.transferFrom(stealth, address(this), usdcAmount);

        // Step 2: Calculate ETH to send (1% spread)
        // ethToSend = usdcAmount × 0.99 / ethPrice × 1e12
        // (USDC has 6 decimals, ETH has 18, so × 1e12 to adjust)
        uint256 ethToSend = (usdcAmount * 99 * 1e12) / (ethPrice * 100);

        // Step 3: Flash loan WETH from Morpho
        s_recipient = recipient;
        s_flashAmount = ethToSend;
        s_direction = 0;

        bytes memory data = abi.encode(ethToSend, usdcAmount);
        IMorpho(MORPHO).flashLoan(WETH, ethToSend, data);

        // Step 4: After callback — surplus WETH stays as revenue
        emit SwapExecuted(stealth, recipient, 0, usdcAmount, ethToSend);
    }

    // ─── ETH → USDC ────────────────────────────────────────────────────────
    /**
     * @notice Swap ETH → USDC. The stealth already sent ETH to this
     *         contract. Relayer calls this to execute the swap.
     * @param recipient  Who receives USDC (stealth address)
     * @param ethPrice   ETH price in USD × 1e6
     */
    function swapETHForUSDC(address recipient, uint256 ethPrice) external payable nonReentrant {
        uint256 ethAmount = msg.value;
        require(ethAmount > 0, "Zero ETH");
        require(ethPrice > 0, "Zero price");

        // Wrap ETH → WETH
        weth.deposit{value: ethAmount}();

        // Calculate USDC to send (1% spread)
        // usdcToSend = ethAmount × ethPrice × 0.99 / 1e18 / 1e6
        // = ethAmount × ethPrice × 99 / (1e24 × 100)
        uint256 usdcToSend = (ethAmount * ethPrice * 99) / (1e24 * 100);

        // Flash loan USDC from Morpho
        s_recipient = recipient;
        s_flashAmount = usdcToSend;
        s_direction = 1;

        bytes memory data = abi.encode(usdcToSend, ethAmount);
        IMorpho(MORPHO).flashLoan(USDC, usdcToSend, data);

        emit SwapExecuted(address(this), recipient, 1, ethAmount, usdcToSend);
    }

    // ─── Morpho flash loan callback ────────────────────────────────────────
    /**
     * @notice Called by Morpho after sending the flash-loaned tokens.
     *         Must repay the exact same amount before returning.
     */
    function onMorphoFlashLoan(bytes memory data) external {
        require(msg.sender == MORPHO, "Only Morpho");

        if (s_direction == 0) {
            _usdcToEthCallback(data);
        } else {
            _ethToUsdcCallback(data);
        }
    }

    // ─── USDC → ETH callback ───────────────────────────────────────────────
    function _usdcToEthCallback(bytes memory data) internal {
        (uint256 wethBorrowed, uint256 usdcToSwap) = abi.decode(data, (uint256, uint256));

        // Unwrap WETH → ETH
        weth.withdraw(wethBorrowed);

        // Send ETH to recipient
        (bool success,) = s_recipient.call{value: wethBorrowed}("");
        require(success, "ETH send failed");

        // Swap USDC → WETH on Curve to repay Morpho
        usdc.approve(CURVE_POOL, usdcToSwap);
        curve.exchange(0, 1, usdcToSwap, wethBorrowed);

        // Repay Morpho — transfer WETH back
        weth.transfer(MORPHO, wethBorrowed);
    }

    // ─── ETH → USDC callback ───────────────────────────────────────────────
    function _ethToUsdcCallback(bytes memory data) internal {
        (uint256 usdcBorrowed, uint256 wethToSwap) = abi.decode(data, (uint256, uint256));

        // Send USDC to recipient
        usdc.transfer(s_recipient, usdcBorrowed);

        // Swap WETH → USDC on Curve to repay Morpho
        weth.approve(CURVE_POOL, wethToSwap);
        curve.exchange(1, 0, wethToSwap, usdcBorrowed);

        // Repay Morpho — transfer USDC back
        usdc.transfer(MORPHO, usdcBorrowed);
    }

    // ─── Revenue withdrawal ────────────────────────────────────────────────
    /**
     * @notice Owner withdraws accumulated swap revenue (surplus
     *         WETH or USDC left in the contract).
     */
    function withdrawRevenue(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
        emit RevenueWithdrawn(token, msg.sender, amount);
    }

    /**
     * @notice Owner withdraws accumulated ETH revenue.
     */
    function withdrawETH(uint256 amount) external onlyOwner {
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH withdraw failed");
    }

    // ─── Fallback to accept ETH ────────────────────────────────────────────
    receive() external payable {}
}

// ─── Interfaces ─────────────────────────────────────────────────────────────
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

interface ICurvePool {
    // exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external returns (uint256);
    function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256);
}

interface IMorpho {
    function flashLoan(address token, uint256 assets, bytes memory data) external;
}

interface IUSDCPermit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}
