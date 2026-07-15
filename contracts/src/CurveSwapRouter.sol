// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CurveSwapRouter — Zero-capital USDC↔ETH swap via Curve Finance.
 *
 * No flash loan. Direct Curve swaps. Tested on-chain.
 */
contract CurveSwapRouter is Ownable {
    address public constant CURVE_POOL = 0xF2EcC3A2dEFB4ECC1Ac510CBbc405a539A990BE4;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    event SwapExecuted(address indexed recipient, uint8 direction, uint256 amountIn, uint256 amountOut);
    event RevenueWithdrawn(address indexed token, address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function swapUSDCForETHPreFunded(address payable recipient, uint256 usdcAmount) external {
        uint256 bal = IERC20(USDC).balanceOf(address(this));
        require(bal >= usdcAmount, "Insufficient USDC");

        IERC20(USDC).approve(CURVE_POOL, usdcAmount);
        uint256 wethOut = ICurvePool(CURVE_POOL).exchange(0, 1, usdcAmount, 0);
        IWETH9(payable(WETH)).withdraw(wethOut);
        (bool success,) = recipient.call{value: wethOut}("");
        require(success, "ETH send failed");

        emit SwapExecuted(recipient, 0, usdcAmount, wethOut);
    }

    function swapETHForUSDC(address recipient) external payable {
        uint256 ethAmount = msg.value;
        IWETH9(payable(WETH)).deposit{value: ethAmount}();
        IWETH9(payable(WETH)).approve(CURVE_POOL, ethAmount);
        uint256 usdcOut = ICurvePool(CURVE_POOL).exchange(1, 0, ethAmount, 0);
        IERC20(USDC).transfer(recipient, usdcOut);

        emit SwapExecuted(recipient, 1, ethAmount, usdcOut);
    }

    function withdrawRevenue(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(msg.sender, amount);
        emit RevenueWithdrawn(token, msg.sender, amount);
    }

    function withdrawETH(uint256 amount) external onlyOwner {
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH withdraw failed");
    }

    receive() external payable {}
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

interface ICurvePool {
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external returns (uint256);
    function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256);
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}
