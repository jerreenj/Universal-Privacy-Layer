// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StealthAddressRegistry
 * @notice Registry for stealth address announcements
 * @dev Stores ephemeral public keys and view tags for stealth address scanning
 */
contract StealthAddressRegistry {
    
    // Announcement structure
    struct Announcement {
        address ephemeralPublicKey;
        bytes32 viewTag;
        uint256 timestamp;
        address announcer;
    }
    
    // Events
    event StealthAnnouncement(
        address indexed recipient,
        address indexed ephemeralPublicKey,
        bytes32 indexed viewTag,
        uint256 timestamp
    );
    
    // Storage
    Announcement[] public announcements;
    
    // Mapping: recipient => announcement indices
    mapping(address => uint256[]) public recipientAnnouncements;
    
    // Mapping: viewTag => announcement index (for quick lookup)
    mapping(bytes32 => uint256) public viewTagIndex;
    
    /**
     * @notice Announce a stealth address transfer
     * @param recipient The stealth address recipient
     * @param ephemeralPublicKey The ephemeral public key used
     * @param viewTag The view tag for quick scanning
     */
    function announce(
        address recipient,
        address ephemeralPublicKey,
        bytes32 viewTag
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(ephemeralPublicKey != address(0), "Invalid ephemeral key");
        
        uint256 index = announcements.length;
        
        announcements.push(Announcement({
            ephemeralPublicKey: ephemeralPublicKey,
            viewTag: viewTag,
            timestamp: block.timestamp,
            announcer: msg.sender
        }));
        
        recipientAnnouncements[recipient].push(index);
        viewTagIndex[viewTag] = index;
        
        emit StealthAnnouncement(
            recipient,
            ephemeralPublicKey,
            viewTag,
            block.timestamp
        );
    }
    
    /**
     * @notice Get all announcements for a recipient
     * @param recipient The recipient address
     * @return indices Array of announcement indices
     */
    function getAnnouncementsForRecipient(
        address recipient
    ) external view returns (uint256[] memory) {
        return recipientAnnouncements[recipient];
    }
    
    /**
     * @notice Get announcement details by index
     * @param index The announcement index
     */
    function getAnnouncement(
        uint256 index
    ) external view returns (
        address ephemeralPublicKey,
        bytes32 viewTag,
        uint256 timestamp,
        address announcer
    ) {
        require(index < announcements.length, "Invalid index");
        Announcement memory a = announcements[index];
        return (a.ephemeralPublicKey, a.viewTag, a.timestamp, a.announcer);
    }
    
    /**
     * @notice Get announcement by view tag
     * @param viewTag The view tag to lookup
     */
    function getByViewTag(
        bytes32 viewTag
    ) external view returns (
        address ephemeralPublicKey,
        uint256 timestamp,
        address announcer
    ) {
        uint256 index = viewTagIndex[viewTag];
        require(index < announcements.length || viewTag == announcements[0].viewTag, "Not found");
        Announcement memory a = announcements[index];
        return (a.ephemeralPublicKey, a.timestamp, a.announcer);
    }
    
    /**
     * @notice Get total number of announcements
     */
    function getAnnouncementCount() external view returns (uint256) {
        return announcements.length;
    }
    
    /**
     * @notice Scan announcements within a block range
     * @param fromBlock Start timestamp
     * @param toBlock End timestamp
     * @return viewTags Array of view tags in range
     */
    function scanRange(
        uint256 fromBlock,
        uint256 toBlock
    ) external view returns (bytes32[] memory) {
        uint256 count = 0;
        
        // First pass: count matching announcements
        for (uint256 i = 0; i < announcements.length; i++) {
            if (announcements[i].timestamp >= fromBlock && 
                announcements[i].timestamp <= toBlock) {
                count++;
            }
        }
        
        // Second pass: collect view tags
        bytes32[] memory viewTags = new bytes32[](count);
        uint256 idx = 0;
        
        for (uint256 i = 0; i < announcements.length; i++) {
            if (announcements[i].timestamp >= fromBlock && 
                announcements[i].timestamp <= toBlock) {
                viewTags[idx] = announcements[i].viewTag;
                idx++;
            }
        }
        
        return viewTags;
    }
}