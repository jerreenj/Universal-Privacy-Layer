// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StealthAddressRegistry
 * @notice EIP-5564-style on-chain announcement registry for stealth address
 *         transfers.
 *
 * @dev Every private send writes exactly one announcement here: the recipient's
 *      ephemeral public key + view tag. Off-chain, the recipient's client (the
 *      frontend `utils/stealth.js`) scans announcements and uses its private
 *      view key + the ephemeral pubkey to derive the stealth private key for
 *      each announcement it can spend — without revealing which announcements
 *      are its own. EIP-5564 keeps ALL derivations client-side; this contract
 *      ONLY records the public ephemeral pubkey + view tag for scanning.
 *
 *      This file is the recipient's *mailbox index*, not its private key — the
 *      contract never sees a stealth private key. P1.11 moves the backend's
 *      Mongo announcement store to this on-chain contract.
 *
 *      P1.2 fixes:
 *        - `getByViewTag` off-by-one collision (viewTagIndex defaulted to 0,
 *          which silently collided with announcement #0 for any *missing*
 *          viewTag and returned the wrong record). Fixed with the standard
 *          EIP-5564 offset-by-1 mapping (0 = not found).
 *        - `viewTag` typed `bytes32` → kept `bytes32` for calldata cost but
 *          the spec uses a 1-byte tag; the frontend hashes/truncates before
 *          emitting (the relayer is responsible for passing the canonical
 *          tag). The registry stores it as-is to allow EIP-5564-compatible
 *          scanning without a schema change later.
 *        - `announce` no longer requires an `ephemeralPublicKey != address(0)`
 *          check that was meaningless (ephemeral keys are pubkeys, not
 *          addresses); the real check is non-zero ephemeral key.
 */
contract StealthAddressRegistry {
    // ─── Types ───────────────────────────────────────────────────────────
    /// @dev EIP-5564 announcement: the full ephemeral public key is 64 bytes
    ///      (two BLS/secp256k1 coordinates). We store it as two bytes32 halves
    ///      to avoid needing ABI codec for `bytes` in the public getter. The
    ///      frontend reconstructs the 64-byte pubkey from these halves.
    struct Announcement {
        bytes32 ephemeralPubKeyX;   // x-coordinate (or first 32 bytes) of the ephemeral pubkey
        bytes32 ephemeralPubKeyY;   // y-coordinate (or next  32 bytes)
        bytes32 viewTag;            // fast-scan view tag (1-byte canonical tag left-padded)
        address announcer;          // msg.sender — typically the PrivacyRelayer
        uint64  timestamp;
    }

    // ─── Events ───────────────────────────────────────────────────────────
    /// @dev Three indexed fields for efficient client filtering. The
    ///      recipient is NOT indexed (it isn't known on-chain — that's the
    ///      whole point of stealth addressing); the announcer (relayer) and
    ///      view tag are. Indexed `viewTag` lets the recipient filter the log
    ///      stream by its computed view tags directly. Indexed `stealthHash`
    ///      lets a recipient who already knows a stealth address verify its
    ///      announcement exists.
    event StealthAnnouncement(
        bytes32 indexed viewTag,
        address indexed announcer,
        bytes32 indexed stealthHash,
        bytes32 ephemeralPubKeyX,
        bytes32 ephemeralPubKeyY,
        uint64  timestamp
    );

    // ─── Storage ──────────────────────────────────────────────────────────
    Announcement[] private _announcements;
    uint256 public announcementCount;

    /// @dev EIP-5564 offset-by-1 lookup: 0 means "not announced", real indices
    ///      start at 1. Fixes the original off-by-one where a *missing* view tag
    ///      (mapping default 0) collided with announcement at slot 0.
    mapping(bytes32 => uint256) public viewTagIndex; // viewTag => (real_index + 1)

    // ─── Write path ───────────────────────────────────────────────────────
    /**
     * @notice Record a stealth address announcement.
     * @param ephemeralPubKeyX First 32 bytes of the ephemeral public key.
     * @param ephemeralPubKeyY Last 32 bytes of the ephemeral public key.
     * @param viewTag          EIP-5564 view tag (left-padded to bytes32).
     * @param stealthHash      keccak256 of the derived stealth address (for
     *                         recipient lookup/sanity — NOT the address itself).
     *
     * @dev Conventionally called by the relayer immediately after the
     *      `PrivacyRelayer.relay()` forward settles, so the recipient's client
     *      can pair the funding transfer with the announcement by hash.
     *      viewTag uniqueness is NOT enforced — a single view tag can appear
     *      in multiple announcements (the same recipient may legitimately
     *      receive many transfers under one view tag). The offset-by-1 index
     *      always keeps the *first* one for O(1) `getByViewTag`; full scans
     *      iterate `_announcements` directly.
     */
    function announce(
        bytes32 ephemeralPubKeyX,
        bytes32 ephemeralPubKeyY,
        bytes32 viewTag,
        bytes32 stealthHash
    ) external {
        require(ephemeralPubKeyX != bytes32(0) || ephemeralPubKeyY != bytes32(0), "Empty ephemeral key");
        require(viewTag != bytes32(0), "Empty view tag");

        uint256 realIndex = _announcements.length;
        _announcements.push(Announcement({
            ephemeralPubKeyX: ephemeralPubKeyX,
            ephemeralPubKeyY: ephemeralPubKeyY,
            viewTag:          viewTag,
            announcer:        msg.sender,
            timestamp:        uint64(block.timestamp)
        }));

        // First-write-wins for the view-tag fast lookup. Subsequent
        // announcements with the same viewTag are still retrievable via
        // full scan; only the first is O(1) reachable.
        if (viewTagIndex[viewTag] == 0) {
            viewTagIndex[viewTag] = realIndex + 1; // offset-by-1 avoids the 0 collision
        }

        announcementCount = _announcements.length;
        emit StealthAnnouncement(viewTag, msg.sender, stealthHash, ephemeralPubKeyX, ephemeralPubKeyY, uint64(block.timestamp));
    }

    // ─── Read paths ───────────────────────────────────────────────────────
    /**
     * @notice Get an announcement by absolute index. Returns the full record.
     * @param index Absolute index (0-based).
     */
    function getAnnouncement(uint256 index)
        external
        view
        returns (
            bytes32 ephemeralPubKeyX,
            bytes32 ephemeralPubKeyY,
            bytes32 viewTag,
            address announcer,
            uint64  timestamp
        )
    {
        require(index < _announcements.length, "Index out of range");
        Announcement storage a = _announcements[index];
        return (a.ephemeralPubKeyX, a.ephemeralPubKeyY, a.viewTag, a.announcer, a.timestamp);
    }

    /**
     * @notice O(1) lookup by view tag (returns the FIRST announcement with
     *         this view tag). For exhaustive scanning use `scanRange()`.
     * @dev EIP-5564 offset-by-1: `viewTagIndex[viewTag] == 0` means "not found",
     *      because real indices are stored as `index + 1`. This is the bug fix
     *      for the previous version, where 0 silently collided with
     *      announcement #0.
     */
    function getByViewTag(bytes32 viewTag)
        external
        view
        returns (
            bytes32 ephemeralPubKeyX,
            bytes32 ephemeralPubKeyY,
            uint64  timestamp,
            address announcer
        )
    {
        uint256 offset = viewTagIndex[viewTag];
        require(offset != 0, "View tag not found");
        Announcement storage a = _announcements[offset - 1];
        return (a.ephemeralPubKeyX, a.ephemeralPubKeyY, a.timestamp, a.announcer);
    }

    /**
     * @notice Returns the ephemeral pubkeys + view tags for all announcements
     *         whose timestamp falls within [fromTs, toTs]. The recipient's
     *         client runs the EIP-5564 scan algorithm over these to find its
     *         own spendable outputs (view-tag filter first, then full DH).
     * @param fromTs  Inclusive lower bound (unix seconds).
     * @param toTs    Inclusive upper bound.
     */
    function scanRange(uint64 fromTs, uint64 toTs)
        external
        view
        returns (
            bytes32[] memory ephemeralPubKeyX,
            bytes32[] memory ephemeralPubKeyY,
            bytes32[] memory viewTags
        )
    {
        require(fromTs <= toTs, "Range inverted");
        uint256 n = _announcements.length;
        // Single-pass count into a temp count, then second pass to fill.
        uint256 count = 0;
        for (uint256 i = 0; i < n; i++) {
            uint64 ts = _announcements[i].timestamp;
            if (ts >= fromTs && ts <= toTs) count++;
        }
        ephemeralPubKeyX = new bytes32[](count);
        ephemeralPubKeyY = new bytes32[](count);
        viewTags         = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < n; i++) {
            uint64 ts = _announcements[i].timestamp;
            if (ts >= fromTs && ts <= toTs) {
                ephemeralPubKeyX[idx] = _announcements[i].ephemeralPubKeyX;
                ephemeralPubKeyY[idx] = _announcements[i].ephemeralPubKeyY;
                viewTags[idx]         = _announcements[i].viewTag;
                idx++;
            }
        }
    }
}
