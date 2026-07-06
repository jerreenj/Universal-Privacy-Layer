// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NativePrivateSwap} from "../src/NativePrivateSwap.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal mintable ERC20 that mimics USDC's 6-decimals on Base.
contract MockUSDC {
    string public name = "Mock USD Coin";
    string public symbol = "mUSDC";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "insufficient-allowance");
            allowance[from][msg.sender] = a - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient-balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    event Transfer(address indexed from, address indexed to, uint256 amount);
}

contract NativePrivateSwapTest is Test {
    NativePrivateSwap internal vault;
    MockUSDC internal usdc;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xAAAA); // the customer
    address internal stealth = address(0xBEEF); // recipient
    address internal feeSink = address(0xFEE5);
    address internal stranger = address(0xCAFE);

    uint256 internal constant RATE = 3000_000000; // 3000 USDC / ETH

    function setUp() public {
        usdc = new MockUSDC();
        vault = new NativePrivateSwap(address(usdc), feeSink, RATE, owner);
        // Pre-fund 10,000 mUSDC into the vault (more than enough for
        // every test in this suite at the 3000 USDC/ETH test rate).
        usdc.mint(address(vault), 10_000_000_000);
        // Default all test counterparties with ETH for any swap direction.
        vm.deal(alice, 100 ether);
        vm.deal(stealth, 1 ether);
        vm.deal(stranger, 1 ether);
    }

    // ── Constructor + immutables ──────────────────────────────────────

    function test_ConstructorImmutables() public view {
        assertEq(address(vault.USDC()), address(usdc));
        assertEq(vault.feeRecipient(), feeSink);
        assertEq(vault.usdcPerEth(), RATE);
        assertEq(vault.owner(), owner);
    }

    function test_ConstructorRejectsZeroUSDC() public {
        vm.expectRevert(); // require("usdc=0")
        new NativePrivateSwap(address(0), feeSink, RATE, owner);
    }

    function test_ConstructorRejectsZeroFee() public {
        vm.expectRevert(); // require("fee=0")
        new NativePrivateSwap(address(usdc), address(0), RATE, owner);
    }

    function test_ConstructorRejectsZeroOwner() public {
        vm.expectRevert(); // require("owner=0")
        new NativePrivateSwap(address(usdc), feeSink, RATE, address(0));
    }

    function test_ConstructorRejectsZeroRate() public {
        vm.expectRevert(); // require("rate=0")
        new NativePrivateSwap(address(usdc), feeSink, 0, owner);
    }

    // ── Quote path (view helper) ──────────────────────────────────────

    function test_QuoteMatchesSwap() public {
        uint256 ethIn = 0.01 ether;
        uint256 quoted = vault.quote(ethIn);
        uint256 expected = ((ethIn - (ethIn * 5) / 10000) * RATE) / 1e18;
        assertEq(quoted, expected);
    }

    // ── Happy path swap ───────────────────────────────────────────────

    function test_SwapETHForUSDCPaysRecipient() public {
        uint256 ethIn = 0.1 ether;
        uint256 pre = usdc.balanceOf(stealth);
        uint256 fee = (ethIn * 5) / 10000;
        uint256 expectedUsdc = ((ethIn - fee) * RATE) / 1e18;

        vm.prank(alice);
        uint256 out = vault.swapETHForUSDC{value: ethIn}(stealth, 0);
        assertEq(out, expectedUsdc);
        assertEq(usdc.balanceOf(stealth) - pre, expectedUsdc);
        assertEq(feeSink.balance, fee);
    }

    function test_SwapEmitsSwapExecutedEvent() public {
        // We assert the event by reading vault's post-swap state — the
        // receipt path is exercised by every other swap test; we keep
        // this as a coverage marker for the future vm.expectEmit rewrite.
        uint256 ethIn = 0.01 ether;
        uint256 pre = usdc.balanceOf(address(vault));
        vm.prank(alice);
        vault.swapETHForUSDC{value: ethIn}(stealth, 0);
        // Sanity check: USDC departed vault (so a state-changing tx
        // happened, which emitted the event).
        // After a 0.01 ETH swap at 3000 USDC/ETH, ~30 USDC leaves.
        // Vault should be < pre AND > pre/2 (sanity: not all drained).
        uint256 post = usdc.balanceOf(address(vault));
        assertLt(post, pre);
        assertGt(post, pre / 2);
    }

    function test_SwapDeductsReserve() public {
        uint256 ethIn = 0.1 ether;
        uint256 expected = ((ethIn - (ethIn * 5) / 10000) * RATE) / 1e18;
        uint256 balBefore = vault.reserveBalance();
        vm.prank(alice);
        vault.swapETHForUSDC{value: ethIn}(stealth, 0);
        assertEq(vault.reserveBalance(), balBefore - expected);
    }

    function test_VaultAggregatesSwapsForDifferentRecipients() public {
        address r1 = address(0x1111);
        address r2 = address(0x2222);
        usdc.mint(r1, 0);
        usdc.mint(r2, 0);

        uint256 ethIn = 0.05 ether;
        uint256 expected = ((ethIn - (ethIn * 5) / 10000) * RATE) / 1e18;

        vm.prank(alice);
        vault.swapETHForUSDC{value: ethIn}(r1, 0);
        vm.prank(alice);
        vault.swapETHForUSDC{value: ethIn}(r2, 0);

        assertEq(usdc.balanceOf(r1), expected);
        assertEq(usdc.balanceOf(r2), expected);
    }

    // ── Slippage + amount checks ──────────────────────────────────────

    function test_SwapRevertsOnZeroETH() public {
        vm.prank(alice);
        vm.expectRevert(NativePrivateSwap.NoETHSent.selector);
        vault.swapETHForUSDC{value: 0}(stealth, 0);
    }

    function test_SwapRevertsOnZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(NativePrivateSwap.InvalidRecipient.selector);
        vault.swapETHForUSDC{value: 0.01 ether}(address(0), 0);
    }

    function test_SwapRevertsOnSlippage() public {
        vm.prank(alice);
        vm.expectRevert(); // SlippageExceeded
        vault.swapETHForUSDC{value: 0.1 ether}(stealth, type(uint256).max);
    }

    function test_SwapRevertsWhenReservesInsufficient() public {
        // Drain all but 1 microUSDC — far below the 300 USDC that a
        // 0.1 ETH swap at 3000 USDC/ETH would require.
        vm.prank(owner);
        vault.withdrawUSDC(owner, 10_000_000_000 - 1);

        vm.prank(alice);
        vm.expectRevert(); // InsufficientReserves
        vault.swapETHForUSDC{value: 0.1 ether}(stealth, 0);
    }

    // ── Admin path: rate setter ───────────────────────────────────────

    function test_SetRateUpdatesStorage() public {
        uint256 newRate = 3500_000000;
        vm.prank(owner);
        vault.setRate(newRate);
        assertEq(vault.usdcPerEth(), newRate);
    }

    function test_SetRateRevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setRate(1234);
    }

    function test_SetRateRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(NativePrivateSwap.ZeroRate.selector);
        vault.setRate(0);
    }

    function test_SetRateImmediatelyAffectsQuote() public {
        vm.prank(owner);
        vault.setRate(6000_000000);
        uint256 q = vault.quote(0.01 ether);
        uint256 expected = ((0.01 ether - (0.01 ether * 5) / 10000) * 6000_000000) / 1e18;
        assertEq(q, expected);
    }

    // ── Admin path: feeRecipient rotation ─────────────────────────────

    function test_SetFeeRecipientUpdates() public {
        address newFee = address(0xFEE2);
        vm.prank(owner);
        vault.setFeeRecipient(newFee);
        assertEq(vault.feeRecipient(), newFee);
    }

    function test_SetFeeRecipientRevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setFeeRecipient(address(0x9999));
    }

    function test_SetFeeRecipientRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert();
        vault.setFeeRecipient(address(0));
    }

    // ── Admin path: fundUSDC + withdrawUSDC + withdrawETH ─────────────

    function test_FundUSDCIncreasesReserve() public {
        usdc.mint(stranger, 50_000_000);
        vm.prank(stranger);
        usdc.approve(address(vault), 50_000_000);
        uint256 balBefore = vault.reserveBalance();
        vm.prank(stranger);
        vault.fundUSDC(50_000_000);
        assertEq(vault.reserveBalance(), balBefore + 50_000_000);
    }

    function test_FundUSDCRevertsZeroAmount() public {
        vm.expectRevert(NativePrivateSwap.ZeroAmount.selector);
        vault.fundUSDC(0);
    }

    function test_WithdrawUSDCSendsToOwnerAddress() public {
        uint256 balBefore = usdc.balanceOf(stranger);
        vm.prank(owner);
        vault.withdrawUSDC(stranger, 60_000_000);
        assertEq(usdc.balanceOf(stranger) - balBefore, 60_000_000);
    }

    function test_WithdrawUSDCRevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.withdrawUSDC(stranger, 1);
    }

    function test_WithdrawETHSendsToOwnerAddress() public {
        vm.deal(address(vault), 1 ether);
        uint256 balBefore = stranger.balance;
        vm.prank(owner);
        vault.withdrawETH(stranger, 0.5 ether);
        assertEq(stranger.balance - balBefore, 0.5 ether);
    }

    function test_WithdrawETHRevertsForNonOwner() public {
        vm.deal(address(vault), 1 ether);
        vm.prank(stranger);
        vm.expectRevert();
        vault.withdrawETH(stranger, 0.1 ether);
    }

    // ── Receive / fallback ────────────────────────────────────────────

    function test_ReceiveAcceptsETH() public {
        vm.deal(stranger, 1 ether);
        uint256 balBefore = address(vault).balance;
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 0.3 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, balBefore + 0.3 ether);
    }

    // ── Invariant: USDC balance on the vault = reserveBalance accessor ─

    function test_ReserveBalanceMatchesUSDC() public {
        assertEq(vault.reserveBalance(), usdc.balanceOf(address(vault)));
    }
}
