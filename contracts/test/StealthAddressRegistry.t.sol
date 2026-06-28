// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StealthAddressRegistry} from "../src/StealthAddressRegistry.sol";

/// @title StealthAddressRegistry Smoke Test
/// @notice P1.4 smoke test — verifies the project compiles + the test harness
///         runs, and locks in the P1.2 offset-by-1 `getByViewTag` fix so a
///         regression here fails loudly. Full per-contract suites land in P1.5.
contract StealthAddressRegistrySmokeTest is Test {
    StealthAddressRegistry internal registry;
    address internal announcer = address(0xA11CE);

    function setUp() public {
        registry = new StealthAddressRegistry();
    }

    /// @dev Announcement #0 must be retrievable AND a *missing* view tag must
    ///      revert — the original bug was that a missing tag (mapping default 0)
    ///      silently returned announcement #0.
    function test_AnnounceAndGetByViewTag() public {
        bytes32 x = bytes32(uint256(0xCAFE));
        bytes32 y = bytes32(uint256(0xBABE));
        bytes32 tag = bytes32(uint256(1));
        bytes32 stealthHash = keccak256("stealth");

        vm.prank(announcer);
        registry.announce(x, y, tag, stealthHash);

        assertEq(registry.announcementCount(), 1, "count");

        // The same tag must resolve to the first announcement.
        (bytes32 rx, bytes32 ry, uint64 ts, address who) = registry.getByViewTag(tag);
        assertEq(rx, x, "x");
        assertEq(ry, y, "y");
        assertEq(who, announcer, "announcer");
        assertGt(ts, 0, "timestamp set");
    }

    /// @dev The bug fix: a view tag that was never announced must revert, not
    ///      return announcement #0. This is the P1.2 regression guard.
    function testRevert_MissingViewTagDoesNotReturnZero() public {
        // Announce once under tag 1.
        vm.prank(announcer);
        registry.announce(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(1)), keccak256("a"));

        // Query a tag that was never announced.
        bytes32 unseen = bytes32(uint256(0x9999));
        vm.expectRevert("View tag not found");
        registry.getByViewTag(unseen);
    }

    /// @dev Empty ephemeral key and empty view tag are rejected.
    function testRevert_EmptyKey() public {
        vm.expectRevert("Empty ephemeral key");
        registry.announce(bytes32(0), bytes32(0), bytes32(uint256(1)), keccak256("a"));
    }

    function testRevert_EmptyViewTag() public {
        vm.expectRevert("Empty view tag");
        registry.announce(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(0), keccak256("a"));
    }

    /// @dev scanRange returns the announcement within the time window.
    function test_ScanRangeReturnsMatch() public {
        bytes32 tag = bytes32(uint256(1));
        vm.prank(announcer);
        registry.announce(bytes32(uint256(1)), bytes32(uint256(2)), tag, keccak256("a"));

        vm.warp(100);
        (bytes32[] memory xs, bytes32[] memory ys, bytes32[] memory tags) = registry.scanRange(0, type(uint64).max);
        assertEq(xs.length, 1, "scan count");
        assertEq(tags[0], tag, "scan tag");
        // Silence unused-var warnings without spending gas on asserts.
        ys.length;
    }
}
