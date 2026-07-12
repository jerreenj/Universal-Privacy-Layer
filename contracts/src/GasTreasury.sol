// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GasTreasury
 * @notice Auto-funds rotating relayer wallets with gas ETH.
 *
 *   The operator funds this contract ONCE with a lump sum of ETH.
 *   Every time the backend rotates the relayer (every ~100
 *   transactions), it calls `fundRelayer(newRelayer)` here — the
 *   treasury sends 0.005 ETH to the new relayer wallet
 *   automatically. The operator never touches individual relayer
 *   wallets.
 *
 *   At Base gas prices (~0.01 gwei), 0.005 ETH covers ~3,000+
 *   transactions per relayer — far more than the 100-tx rotation
 *   window. So each relayer always has plenty of gas.
 *
 *   Funding math:
 *     0.005 ETH per relayer × N relayers = total ETH needed
 *     0.01 ETH = 2 relayer rotations (200 transactions)
 *     0.05 ETH = 10 rotations (1,000 transactions)
 *     0.1 ETH = 20 rotations (2,000 transactions)
 */
contract GasTreasury is Ownable {
    /// @dev Gas top-up per new relayer. 0.005 ETH = plenty for 100+
    ///      transactions on Base at current gas prices.
    uint256 public constant GAS_TOPUP = 0.005 ether;

    /// @dev Total ETH sent to each relayer (audit trail).
    mapping(address => uint256) public fundedAmounts;

    /// @dev Total relayers funded (counter).
    uint256 public totalRelayersFunded;

    event RelayerFunded(address indexed relayer, uint256 amount);
    event TreasuryFunded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Send GAS_TOPUP ETH to a new relayer wallet. Only the
     *         owner (the backend operator) can call this — it's
     *         called during relayer rotation.
     * @param newRelayer The freshly-generated relayer wallet address.
     */
    function fundRelayer(address payable newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Zero relayer");
        require(address(this).balance >= GAS_TOPUP, "Insufficient treasury balance");
        (bool success,) = newRelayer.call{value: GAS_TOPUP}("");
        require(success, "ETH transfer failed");
        fundedAmounts[newRelayer] += GAS_TOPUP;
        totalRelayersFunded++;
        emit RelayerFunded(newRelayer, GAS_TOPUP);
    }

    /**
     * @notice Withdraw remaining ETH from the treasury. Owner-only,
     *         lets the operator recover unused funds if they ever
     *         shut down the relayer service.
     */
    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Exceeds balance");
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Accept ETH funding from the operator.
    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    /// @dev Read-only: how much ETH is left in the treasury.
    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
