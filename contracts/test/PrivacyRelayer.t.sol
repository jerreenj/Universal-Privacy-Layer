// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PrivacyRelayer} from "../src/PrivacyRelayer.sol";
import {StealthAddressRegistry} from "../src/StealthAddressRegistry.sol";

/// @title PrivacyRelayer Test (P2.9.7)
/// @notice Locks in the atomic `relayAndAnnounce` entry point: a relay + an
///         announce that share ONE transaction, so an announce failure rolls
///         back the forward (no dangling relay). This is the EVM analog of
///         Sui's `relayed_send` PTB and closes the P2.9 parity gap.
contract PrivacyRelayerTest is Test {
    PrivacyRelayer internal relayer;
    StealthAddressRegistry internal registry;

    // Local mirror of PrivacyRelayer.PrivateTransfer — the exact same indexed
    // layout (stealthAddressHash, ephemeralKey, viewTag indexed; amount/fee/ts
    // unindexed) so forge's `vm.expectEmit` can match it against the contract's
    // emitted event. Declaring the reference event locally is the standard
    // forge pattern when the emitting contract isn't the test contract.
    event PrivateTransfer(
        bytes32 indexed stealthAddressHash,
        bytes32 indexed ephemeralKey,
        uint8 indexed viewTag,
        uint256 amount,
        uint256 fee,
        uint256 timestamp
    );

    // The deployer is owner + relayer (matches the solo-relayer MVP constructor).
    address internal deployer = address(this);
    // A throwaway stealth recipient for the forward tests.
    address internal recipient = address(0xB0B);
    uint256 internal constant FEE_BPS = 5; // constructor default
    uint256 internal constant FEE_DENOM = 10_000;

    function setUp() public {
        registry = new StealthAddressRegistry();
        relayer = new PrivacyRelayer();
        // Wire the registry so relayAndAnnounce is usable. deployer == owner.
        relayer.setRegistry(address(registry));
        // Sanity: the deployer is the relayer (constructor sets relayer = msg.sender).
        assertEq(relayer.relayer(), address(this), "deployer is relayer");
    }

    // ─── Atomicity: the headline test ───────────────────────────────────────

    /// @dev relayAndAnnounce forwards `msg.value - fee`, skims the fee, emits
    ///      PrivateTransfer, AND records an announcement in the registry — all
    ///      in one tx. Proves the recipient got paid, the fee accrued, the
    ///      announcement count advanced, and the event fired.
    function test_RelayAndAnnounceIsAtomic() public {
        uint256 amount = 1 ether;
        bytes32 ephemKey = bytes32(uint256(0xCAFE));
        uint8 viewTag = 42;
        bytes32 pubX = bytes32(uint256(0xCAFE));
        bytes32 pubY = bytes32(uint256(0xBABE));
        bytes32 stealthHash = keccak256(abi.encodePacked(recipient));

        uint256 fee = (amount * FEE_BPS) / FEE_DENOM;
        uint256 expectedForward = amount - fee;
        uint256 recipientBefore = recipient.balance;

        vm.expectEmit(true, true, true, true);
        emit PrivateTransfer(
            keccak256(abi.encodePacked(recipient)), ephemKey, viewTag, expectedForward, fee, block.timestamp
        );

        relayer.relayAndAnnounce{value: amount}(recipient, ephemKey, viewTag, pubX, pubY, stealthHash);

        // Forward: recipient received amount - fee.
        assertEq(recipient.balance - recipientBefore, expectedForward, "recipient got amount-fee");
        // Fee accrued.
        assertEq(relayer.accumulatedFees(), fee, "fee accrued");
        // totalRelayed incremented.
        assertEq(relayer.totalRelayed(), expectedForward, "totalRelayed");
        // Announcement recorded in the SAME tx.
        assertEq(registry.announcementCount(), 1, "announcement recorded");
        // The recorded announcement matches the inputs.
        (bytes32 rx, bytes32 ry, bytes32 rTag, address announcer, uint64 ts) = registry.getAnnouncement(0);
        assertEq(rx, pubX, "announce x");
        assertEq(ry, pubY, "announce y");
        // viewTag left-padded to bytes32 via bytes32(uint256(viewTag)).
        assertEq(rTag, bytes32(uint256(viewTag)), "announce viewTag padded");
        assertEq(announcer, address(relayer), "announcer is relayer contract");
        assertGt(ts, 0, "timestamp set");
        // Silence unused-var warnings.
        stealthHash;
    }

    /// @dev THE atomicity proof: if the registry.announce() reverts, the ENTIRE
    ///      tx reverts — the recipient must NOT receive the funds (no dangling
    ///      relay). Uses a mock registry whose announce() always reverts.
    function testRevert_AnnounceFailureRevertsRelay() public {
        RevertingRegistry mockReg = new RevertingRegistry();
        // Re-point the relayer at the reverting mock (owner = deployer).
        relayer.setRegistry(address(mockReg));

        uint256 amount = 1 ether;
        uint256 recipientBefore = recipient.balance;

        // Must revert — propagated from the mock's announce().
        vm.expectRevert("announce intentionally reverts");
        relayer.relayAndAnnounce{value: amount}(
            recipient, bytes32(uint256(0xCAFE)), 42, bytes32(uint256(0xCAFE)), bytes32(uint256(0xBABE)), keccak256("s")
        );

        // Atomicity: recipient balance unchanged — the forward was rolled back.
        assertEq(recipient.balance, recipientBefore, "no dangling relay on announce revert");
        // Fee did NOT accrue (rolled back).
        assertEq(relayer.accumulatedFees(), 0, "fee rolled back");
        // totalRelayed did NOT advance.
        assertEq(relayer.totalRelayed(), 0, "totalRelayed rolled back");
    }

    /// @dev relayAndAnnounce before setRegistry reverts — prevents silently
    ///      relaying without an announcement.
    function testRevert_RegistryNotSet() public {
        // Fresh relayer with no registry wired.
        PrivacyRelayer fresh = new PrivacyRelayer();

        vm.expectRevert("Registry not set");
        fresh.relayAndAnnounce{value: 1 ether}(
            recipient, bytes32(uint256(0xCAFE)), 42, bytes32(uint256(0xCAFE)), bytes32(uint256(0xBABE)), keccak256("s")
        );
    }

    /// @dev setRegistry rejects the zero address (owner-only).
    function testRevert_SetRegistryZero() public {
        vm.expectRevert("Zero registry");
        relayer.setRegistry(address(0));
    }

    /// @dev setRegistry is owner-only — a non-owner cannot rewire the registry.
    function testRevert_SetRegistryNotOwner() public {
        vm.prank(address(0xEA1A1A1A));
        vm.expectRevert();
        relayer.setRegistry(address(0xDEAD));
    }

    // ─── Backward compatibility: relay() still works ────────────────────────

    /// @dev The announce-less relay() path is unchanged and still forwards. This
    ///      guards against a regression where the _relayCore refactor broke the
    ///      original entry point.
    function test_RelayStillWorksStandalone() public {
        uint256 amount = 0.5 ether;
        uint256 fee = (amount * FEE_BPS) / FEE_DENOM;
        uint256 expectedForward = amount - fee;
        uint256 recipientBefore = recipient.balance;

        relayer.relay{value: amount}(recipient, bytes32(uint256(0xCAFE)), 7);

        assertEq(recipient.balance - recipientBefore, expectedForward, "relay forward");
        assertEq(relayer.accumulatedFees(), fee, "relay fee");
        assertEq(relayer.totalRelayed(), expectedForward, "relay totalRelayed");
        // relay() does NOT announce — registry count must stay 0.
        assertEq(registry.announcementCount(), 0, "relay() does not announce");
    }

    /// @dev Only the authorized relayer may call relayAndAnnounce — a random
    ///      address is rejected by onlyRelayer.
    function testRevert_RelayAndAnnounceNotAuthorized() public {
        // value:0 so the onlyRelayer guard (first modifier) is isolated from the
        // value-transfer layer — vm.prank sets a caller with no balance, and a
        // nonzero {value} would revert at the EVM layer (no data) before the
        // modifier runs. onlyRelayer fires before _relayCore's amount check.
        vm.prank(address(0xEA1A1A1A));
        vm.expectRevert("Not authorised relayer");
        relayer.relayAndAnnounce{value: 0}(
            recipient, bytes32(uint256(0xCAFE)), 42, bytes32(uint256(0xCAFE)), bytes32(uint256(0xBABE)), keccak256("s")
        );
    }

    /// @dev Zero-amount and zero-recipient guards still fire via _relayCore.
    function testRevert_RelayAndAnnounceZeroAmount() public {
        vm.expectRevert("Amount must be > 0");
        relayer.relayAndAnnounce{value: 0}(
            recipient, bytes32(uint256(0xCAFE)), 42, bytes32(uint256(0xCAFE)), bytes32(uint256(0xBABE)), keccak256("s")
        );
    }

    function testRevert_RelayAndAnnounceZeroRecipient() public {
        vm.expectRevert("Invalid recipient");
        relayer.relayAndAnnounce{value: 1 ether}(
            address(0), bytes32(uint256(0xCAFE)), 42, bytes32(uint256(0xCAFE)), bytes32(uint256(0xBABE)), keccak256("s")
        );
    }
}

/// @dev A registry stub whose announce() always reverts — used to prove that
///      relayAndAnnounce rolls back the forward when the announce fails.
contract RevertingRegistry {
    function announce(bytes32, bytes32, bytes32, bytes32) external pure {
        revert("announce intentionally reverts");
    }
}
