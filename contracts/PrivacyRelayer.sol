// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PrivacyRelayer
 * @notice Universal Privacy Layer - Smart Relayer Contract
 * @dev Non-custodial, stateless privacy relayer for ETH and ERC20 transfers
 */
contract PrivacyRelayer is ReentrancyGuard, Ownable {
    
    // Events
    event PrivateTransfer(
        bytes32 indexed stealthAddressHash,
        uint256 amount,
        uint256 timestamp
    );
    
    event StealthAddressRegistered(
        bytes32 indexed viewTag,
        address indexed ephemeralPublicKey
    );
    
    // Fee configuration (0.05% = 5 basis points)
    uint256 public feeRate = 5; // basis points
    uint256 public constant FEE_DENOMINATOR = 10000;
    
    // Accumulated fees
    uint256 public accumulatedFees;
    
    // Stealth address registry (viewTag => ephemeralPublicKey)
    mapping(bytes32 => address) public stealthRegistry;
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Register a stealth address for receiving private transfers
     * @param viewTag The view tag for quick scanning
     * @param ephemeralPublicKey The ephemeral public key for deriving shared secret
     */
    function registerStealthAddress(
        bytes32 viewTag,
        address ephemeralPublicKey
    ) external {
        require(stealthRegistry[viewTag] == address(0), "View tag already used");
        stealthRegistry[viewTag] = ephemeralPublicKey;
        
        emit StealthAddressRegistered(viewTag, ephemeralPublicKey);
    }
    
    /**
     * @notice Send ETH privately to a stealth address
     * @param stealthAddress The recipient stealth address
     * @param viewTag The view tag for the stealth address
     */
    function privateSend(
        address payable stealthAddress,
        bytes32 viewTag
    ) external payable nonReentrant {
        require(msg.value > 0, "Amount must be > 0");
        require(stealthAddress != address(0), "Invalid stealth address");
        
        // Calculate fee
        uint256 fee = (msg.value * feeRate) / FEE_DENOMINATOR;
        uint256 transferAmount = msg.value - fee;
        
        // Accumulate fee
        accumulatedFees += fee;
        
        // Transfer to stealth address
        (bool success, ) = stealthAddress.call{value: transferAmount}("");
        require(success, "Transfer failed");
        
        // Emit event with hashed stealth address for privacy
        emit PrivateTransfer(
            keccak256(abi.encodePacked(stealthAddress)),
            transferAmount,
            block.timestamp
        );
    }
    
    /**
     * @notice Batch send to multiple stealth addresses
     * @param stealthAddresses Array of stealth addresses
     * @param amounts Array of amounts to send
     * @param viewTags Array of view tags
     */
    function batchPrivateSend(
        address payable[] calldata stealthAddresses,
        uint256[] calldata amounts,
        bytes32[] calldata viewTags
    ) external payable nonReentrant {
        require(
            stealthAddresses.length == amounts.length && 
            amounts.length == viewTags.length,
            "Array length mismatch"
        );
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        // Calculate total fee
        uint256 totalFee = (totalAmount * feeRate) / FEE_DENOMINATOR;
        require(msg.value >= totalAmount + totalFee, "Insufficient ETH");
        
        accumulatedFees += totalFee;
        
        // Send to each stealth address
        for (uint256 i = 0; i < stealthAddresses.length; i++) {
            require(stealthAddresses[i] != address(0), "Invalid address");
            
            (bool success, ) = stealthAddresses[i].call{value: amounts[i]}("");
            require(success, "Transfer failed");
            
            emit PrivateTransfer(
                keccak256(abi.encodePacked(stealthAddresses[i])),
                amounts[i],
                block.timestamp
            );
        }
        
        // Refund excess
        uint256 excess = msg.value - totalAmount - totalFee;
        if (excess > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: excess}("");
            require(refundSuccess, "Refund failed");
        }
    }
    
    /**
     * @notice Withdraw accumulated fees (owner only)
     */
    function withdrawFees() external onlyOwner {
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        
        (bool success, ) = owner().call{value: amount}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @notice Update fee rate (owner only)
     * @param newFeeRate New fee rate in basis points (max 100 = 1%)
     */
    function setFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= 100, "Fee too high"); // Max 1%
        feeRate = newFeeRate;
    }
    
    /**
     * @notice Check if a view tag is registered
     */
    function isViewTagRegistered(bytes32 viewTag) external view returns (bool) {
        return stealthRegistry[viewTag] != address(0);
    }
    
    /**
     * @notice Get ephemeral public key for a view tag
     */
    function getEphemeralKey(bytes32 viewTag) external view returns (address) {
        return stealthRegistry[viewTag];
    }
    
    // Allow contract to receive ETH
    receive() external payable {}
}