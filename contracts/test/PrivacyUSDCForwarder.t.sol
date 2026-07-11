// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PrivacyUSDCForwarder.sol";

/**
 * Mock USDC for unit tests. Mirrors the 6-decimals USDC on Base mainnet.
 * Caller mints, transfers, burns as needed.
 */
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
        emit Transfer(address(0), to, v);
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }

    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[t] += v;
        emit Transfer(f, t, v);
        return true;
    }
}

contract PrivacyUSDCForwarderTest is Test {
    PrivacyUSDCForwarder internal fwd;
    MockUSDC internal usdc;
    address internal OWNER = address(0xA11CE);
    address internal CUSTOMER = address(0xBEEF);
    address internal RELAYER = address(0xCAFE);
    address internal RECIPIENT = address(0xDEAD);

    function setUp() public {
        fwd = new PrivacyUSDCForwarder();
        usdc = new MockUSDC();
        // Move the ownership of fwd from deployer to our OWNER so we can
        // cleanly call setRelayer.
        vm.prank(fwd.owner());
        fwd.transferOwnership(OWNER);
        // Authorise RELAYER as the relayer role.
        vm.prank(OWNER);
        fwd.setRelayer(RELAYER);
        // Mint USDC for the customer.
        usdc.mint(CUSTOMER, 1_000_000_000); // 1B USDC
        // Customer approves the forwarder for top-up.
        vm.prank(CUSTOMER);
        usdc.approve(address(fwd), type(uint256).max);
    }

    function test_deposit_credits_balance() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        assertEq(fwd.prepaid(CUSTOMER, address(usdc)), 1_000_000);
        assertEq(usdc.balanceOf(address(fwd)), 1_000_000);
    }

    function test_withdraw_returns_balance() public {
        vm.startPrank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        fwd.withdraw(address(usdc), 400_000);
        vm.stopPrank();
        assertEq(fwd.prepaid(CUSTOMER, address(usdc)), 600_000);
        assertEq(usdc.balanceOf(CUSTOMER), 1_000_000_000 - 1_000_000 + 400_000);
    }

    function test_forward_consumes_balance_and_transfers() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        // Non-relayer caller must revert.
        vm.prank(CUSTOMER);
        vm.expectRevert(bytes("Not authorised relayer"));
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 500_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);

        // Authorised relayer forwards the customer's USDC.
        vm.prank(RELAYER);
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 500_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);
        assertEq(fwd.prepaid(CUSTOMER, address(usdc)), 500_000);
        assertEq(usdc.balanceOf(RECIPIENT), 500_000);
        // The Transfer event's from must be the forwarder, never the customer.
        assertEq(usdc.balanceOf(address(fwd)), 500_000);
        assertEq(usdc.balanceOf(CUSTOMER), 1_000_000_000 - 1_000_000);
    }

    function test_forward_replay_blocked_by_nonce() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        // First forward succeeds and bumps nonce to 1.
        vm.prank(RELAYER);
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 100_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);
        // Replay at nonce 0 must revert.
        vm.prank(RELAYER);
        vm.expectRevert(bytes("Bad nonce"));
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 100_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);
    }

    function test_forward_expired_intent_reverts() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        vm.prank(RELAYER);
        vm.expectRevert(bytes("Expired intent"));
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 100_000, bytes32(uint256(1)), 1, 0, block.timestamp - 1);
    }

    function test_forward_insufficient_prepaid_reverts() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 100_000);
        vm.prank(RELAYER);
        vm.expectRevert(bytes("Insufficient prepaid"));
        fwd.forward(CUSTOMER, address(usdc), RECIPIENT, 500_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);
    }

    function test_forward_self_recipient_reverts() public {
        vm.prank(CUSTOMER);
        fwd.deposit(address(usdc), 1_000_000);
        vm.prank(RELAYER);
        vm.expectRevert(bytes("Self recipient"));
        fwd.forward(CUSTOMER, address(usdc), address(fwd), 100_000, bytes32(uint256(1)), 1, 0, block.timestamp + 1);
    }
}
