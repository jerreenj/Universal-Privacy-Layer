// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/GasTreasury.sol";

contract GasTreasuryTest is Test {
    GasTreasury internal treasury;
    address internal OWNER = address(0xA11CE);
    address internal RELAYER1 = address(0xBEEF);
    address internal RELAYER2 = address(0xCAFE);

    function setUp() public {
        treasury = new GasTreasury();
        // Transfer ownership to our test OWNER
        vm.prank(treasury.owner());
        treasury.transferOwnership(OWNER);
        // Fund the treasury with 0.02 ETH
        vm.deal(address(this), 1 ether);
        (bool s,) = address(treasury).call{value: 0.02 ether}("");
        require(s);
    }

    function test_fund_relayer_sends_eth() public {
        vm.prank(OWNER);
        treasury.fundRelayer(payable(RELAYER1));
        assertEq(RELAYER1.balance, 0.005 ether);
        assertEq(treasury.fundedAmounts(RELAYER1), 0.005 ether);
        assertEq(treasury.totalRelayersFunded(), 1);
    }

    function test_fund_multiple_relayers() public {
        vm.startPrank(OWNER);
        treasury.fundRelayer(payable(RELAYER1));
        treasury.fundRelayer(payable(RELAYER2));
        vm.stopPrank();
        assertEq(RELAYER1.balance, 0.005 ether);
        assertEq(RELAYER2.balance, 0.005 ether);
        assertEq(treasury.totalRelayersFunded(), 2);
        assertEq(address(treasury).balance, 0.01 ether); // 0.02 - 0.01 = 0.01
    }

    function test_non_owner_cannot_fund() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        treasury.fundRelayer(payable(RELAYER1));
    }

    function test_zero_relayer_reverts() public {
        vm.prank(OWNER);
        vm.expectRevert(bytes("Zero relayer"));
        treasury.fundRelayer(payable(address(0)));
    }

    function test_insufficient_treasury_reverts() public {
        // Drain treasury to < 0.005
        vm.prank(OWNER);
        treasury.withdraw(0.018 ether);
        vm.prank(OWNER);
        vm.expectRevert(bytes("Insufficient treasury balance"));
        treasury.fundRelayer(payable(RELAYER1));
    }

    function test_withdraw_recovers_funds() public {
        vm.prank(OWNER);
        treasury.withdraw(0.01 ether);
        assertEq(OWNER.balance, 0.01 ether);
        assertEq(address(treasury).balance, 0.01 ether);
    }

    function test_non_owner_cannot_withdraw() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        treasury.withdraw(0.01 ether);
    }

    function test_treasury_balance_read() public {
        assertEq(treasury.treasuryBalance(), 0.02 ether);
    }

    receive() external payable {}
}
