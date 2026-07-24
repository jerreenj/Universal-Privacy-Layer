// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/NoteSettlement.sol";

contract MockVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[2] calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }
}

contract MockVerifierReject {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[2] calldata)
        external
        pure
        returns (bool)
    {
        return false;
    }
}

contract NoteSettlementTest is Test {
    NoteSettlement internal settlement;
    MockVerifier internal mockVerifier;

    function setUp() public {
        mockVerifier = new MockVerifier();
        settlement = new NoteSettlement(address(mockVerifier));
    }

    function test_invalid_proof_reverts() public {
        MockVerifierReject rejectVerifier = new MockVerifierReject();
        NoteSettlement badSettlement = new NoteSettlement(address(rejectVerifier));

        // Set revenue wallet before testing proof validation
        badSettlement.setRevenueWallet(address(0x999));

        uint256[2] memory proofA = [uint256(1), uint256(2)];
        uint256[2][2] memory proofB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory proofC = [uint256(7), uint256(8)];
        uint256[2] memory pubSignals = [uint256(12345), uint256(1000000)];

        vm.expectRevert("Invalid proof");
        badSettlement.settle(proofA, proofB, proofC, pubSignals, address(0x1234));
    }

    function test_non_owner_cannot_withdraw() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        settlement.withdrawUSDC(0);
    }

    function test_non_owner_cannot_fund() public {
        vm.prank(address(0x999));
        vm.expectRevert();
        settlement.fundUSDC(0);
    }

    function test_owner_and_usdc_set_correctly() public {
        assertEq(settlement.owner(), address(this));
        assertEq(settlement.USDC(), 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    }
}
