// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAaveV3 — Minimal Aave V3 interface for flash loans on Base.
 * @notice Aave V3 is deployed on Base at:
 *         PoolAddressesProvider: 0xA238Dd80C259a72e81d7e4664a980159B1977032
 *
 *         Flash loans are FREE (zero capital) — you borrow and repay
 *         in the same transaction. The only cost is the flash loan
 *         premium (currently 0.05% on Aave V3, but 0% for the first
 *         5 entries in the referral program).
 */
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanReceiver {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        returns (bool);
}

interface IERC20Aave {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}
