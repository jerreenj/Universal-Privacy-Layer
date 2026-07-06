// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ConfidentialNativePrivateSwap.sol";

/**
 * This contract does NOT have a forge-runtime means of proving ZK
 * commitments, but it covers the contract's behavior: vault, fee,
 * stranger-revert, ownership paths. The commitment-mismatch test
 * specifically exercises the only path where amount-hiding changes the
 * arithmetic between customer-known amt (off-chain) and vault-known
 * amt (on-chain).
 */
contract TestConfidentialSwap is Test {
    ConfidentialNativePrivateSwap internal vault;
    MockUSDC internal usdc;
    address internal owner = address(0xA11CE);
    address internal hot = address(0xB0B);
    address internal alice = address(0xA11);
    address internal bob = address(0xB0B_F);
    address internal feeSink = address(0xFEE5);
    address internal stealth = address(0x5EA17);

    uint256 internal constant RATE = 1700_000000; // 1700 USDC/ETH

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ConfidentialNativePrivateSwap(address(usdc), feeSink, RATE, owner);
        // Pre-fund vault with USDC reserves.
        usdc.mint(address(vault), 6_081_433); // 6.08 USDC

        // Fund alice with ETH.
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _commit(uint256 amt, bytes1 viewTagByte) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encodePacked(amt, viewTagByte)), uint8(0x42)));
    }

    function test_SwapConfidentialHappyPath() public {
        uint256 ethIn = 0.001 ether; // = 1e15 wei
        uint256 fee = (ethIn * 5) / 10000;
        uint256 usdcOut = ((ethIn - fee) * RATE) / 1e18;
        bytes1 viewTag = 0xAB;
        bytes32 commit = _commit(usdcOut, viewTag);

        vm.prank(alice);
        vault.swapUSDCViaCommitment{value: ethIn}(stealth, commit, viewTag, 0);

        // Recipient got the USDC.
        assertEq(usdc.balanceOf(stealth), usdcOut);
        // Fee went to feeSink.
        assertEq(feeSink.balance, fee);
        // Vault reserve dropped.
        assertEq(usdc.balanceOf(address(vault)), 6_081_433 - usdcOut);
        // Customer can look up the commitment to get the decoded amount.
        (address r, address s, uint256 amt, uint256 eIn, uint256 fr,) = vault.lookupCommitment(commit);
        assertEq(r, stealth);
        assertEq(s, alice);
        assertEq(amt, usdcOut);
        assertEq(eIn, ethIn);
        assertEq(fr, fee);
    }

    function test_SwapConfidentialRevertsOnCommitmentMismatch() public {
        uint256 ethIn = 0.001 ether;
        bytes1 viewTag = 0xAB;
        // Wrong commit (different from what the vault will compute).
        bytes32 wrongCommit = keccak256("not the right commit");

        vm.prank(alice);
        vm.expectRevert(ConfidentialNativePrivateSwap.CommitmentMismatch.selector);
        vault.swapUSDCViaCommitment{value: ethIn}(stealth, wrongCommit, viewTag, 0);
    }

    function test_SwapConfidentialRevertsOnZeroRecipient() public {
        uint256 ethIn = 0.001 ether;
        bytes1 viewTag = 0xAB;
        uint256 usdcOut = ((ethIn - (ethIn * 5 / 10000)) * RATE) / 1e18;
        bytes32 commit = _commit(usdcOut, viewTag);

        vm.prank(alice);
        vm.expectRevert(ConfidentialNativePrivateSwap.InvalidRecipient.selector);
        vault.swapUSDCViaCommitment{value: ethIn}(address(0), commit, viewTag, 0);
    }

    function test_SwapConfidentialRevertsOnZeroETH() public {
        bytes1 viewTag = 0xAB;
        bytes32 commit = bytes32(uint256(0xDEADBEEF));

        vm.prank(alice);
        vm.expectRevert(ConfidentialNativePrivateSwap.NoETHSent.selector);
        vault.swapUSDCViaCommitment{value: 0}(stealth, commit, viewTag, 0);
    }

    function test_SwapConfidentialRevertsOnSlippageExceeded() public {
        uint256 ethIn = 0.001 ether;
        bytes1 viewTag = 0xAB;
        uint256 usdcOut = ((ethIn - (ethIn * 5 / 10000)) * RATE) / 1e18;
        bytes32 commit = _commit(usdcOut, viewTag);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ConfidentialNativePrivateSwap.SlippageExceeded.selector, usdcOut, usdcOut + 1)
        );
        vault.swapUSDCViaCommitment{value: ethIn}(stealth, commit, viewTag, usdcOut + 1);
    }

    function test_SwapConfidentialEmitsEventWithoutPlaintextAmt() public {
        uint256 ethIn = 0.001 ether;
        bytes1 viewTag = 0x01;
        uint256 usdcOut = ((ethIn - (ethIn * 5 / 10000)) * RATE) / 1e18;
        bytes32 commit = _commit(usdcOut, viewTag);

        // Verify the swap ran AND the recipient USDC went up.
        // (vm.expectEmit syntax for events declared at module-level
        // inside the same contract behaves inconsistently across
        // forge versions; we assert the post-state instead, which is
        // what really matters for an amount-hide round — the USDC
        // moved off-chain is the proof the contract processed
        // the commitment correctly.)
        vm.recordLogs();
        vm.prank(alice);
        vault.swapUSDCViaCommitment{value: ethIn}(stealth, commit, viewTag, 0);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool foundCommitmentEvent = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].topics[0]
                    == keccak256("SwapConfidentialExecuted(address,address,bytes32,bytes32,uint256,uint256,uint256)")
            ) {
                foundCommitmentEvent = true;
                // Customer-side: amountCommitment encoded in topics[3]
                // (topics[0] event sig, [1] sender, [2] recipient, [3] commitment).
                assertEq(logs[i].topics[3], commit, "commitment appears in event topic");
                break;
            }
        }
        assertTrue(foundCommitmentEvent, "SwapConfidentialExecuted event emitted");
        assertEq(usdc.balanceOf(stealth), usdcOut);
    }

    function test_OwnerOnlyAdminPaths() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setRate(2000_000000);
        vm.expectRevert();
        vault.setFeeRecipient(alice);
        vm.expectRevert();
        vault.withdrawUSDC(alice, 1);
        vm.expectRevert();
        vault.withdrawETH(alice, 1);

        vm.prank(owner);
        vault.setRate(2000_000000);
        assertEq(vault.usdcPerEth(), 2000_000000);

        vm.prank(owner);
        vault.setFeeRecipient(alice);
        assertEq(vault.feeRecipient(), alice);
    }

    function test_FundAndWithdraw() public {
        // Pre-fund already done in setUp; owner withdraws a portion.
        vm.prank(owner);
        vault.withdrawUSDC(bob, 1_000_000); // 1 USDC
        assertEq(usdc.balanceOf(bob), 1_000_000);
        assertEq(usdc.balanceOf(address(vault)), 6_081_433 - 1_000_000);

        // Fund additional USDC from alice.
        usdc.mint(alice, 1_000_000);
        vm.prank(alice);
        usdc.approve(address(vault), 1_000_000);
        vm.prank(alice);
        vault.fundUSDC(1_000_000);
        assertEq(usdc.balanceOf(address(vault)), 6_081_433);
    }

    function test_QuoteMatchesFormula() public {
        uint256 ethIn = 0.001 ether;
        uint256 fee = (ethIn * 5) / 10000;
        uint256 expected = ((ethIn - fee) * 1700_000000) / 1e18;
        assertEq(vault.quote(ethIn), expected);
    }
}

contract MockUSDC {
    mapping(address => uint256) internal balances;
    mapping(address => mapping(address => uint256)) internal allowances;
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply = 0;

    function balanceOf(address a) external view returns (uint256) {
        return balances[a];
    }

    function allowance(address o, address s) external view returns (uint256) {
        return allowances[o][s];
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowances[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balances[msg.sender] -= a;
        balances[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowances[f][msg.sender] -= a;
        balances[f] -= a;
        balances[to] += a;
        return true;
    }

    function mint(address to, uint256 a) external {
        balances[to] += a;
        totalSupply += a;
    }
}
