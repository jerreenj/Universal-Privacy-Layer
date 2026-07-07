// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ConfidentialReverseSwap} from "../src/ConfidentialReverseSwap.sol";

contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allow");
            allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _move(address from, address to, uint256 amt) internal {
        require(balanceOf[from] >= amt, "bal");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

contract TestConfidentialReverseSwap is Test {
    ConfidentialReverseSwap internal vault;
    MockUSDC internal usdc;

    address internal owner = address(0x0AA1);
    address internal feeSink = address(0xFEE5);
    address internal relayer = address(0x8E1A);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address payable internal recipient = payable(address(0x5EA1));

    uint256 internal constant RATE = 1700_000000; // 1700 USDC/ETH (6-dec)

    uint256 internal relayerPk;
    uint256 internal alicePk;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ConfidentialReverseSwap(address(usdc), feeSink, relayer, RATE, owner);
        // Fund vault with ETH reserves.
        vm.deal(address(vault), 1 ether);
        // Customer (alice) gets USDC.
        usdc.mint(alice, 10_000_000); // 10 USDC
        // Generate deterministic keys for alice + relayer so we can
        // build EIP-712 sigs in-test.
        relayerPk = 0xA11CE_0000;
        alicePk = 0xA11CE_1111;
        // Sanity: addresses derived from these PKs should be stable
        // for the test — we don't actually use them on-chain except
        // for signature recovery checks.
    }

    /// @notice Compute the same commitment the contract uses so the
    ///         happy-path test can submit a matching value.
    function _commit(uint256 ethOut, bytes1 viewTag) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encodePacked(ethOut, viewTag)), uint8(0x43)));
    }

    /// @notice Quote math mirror (5 bps fee, then convert).
    function _ethOut(uint256 usdcIn) internal pure returns (uint256) {
        uint256 fee = (usdcIn * 5) / 10000;
        uint256 swapUsdc = usdcIn - fee;
        return (swapUsdc * 1e18) / RATE;
    }

    function _sign(address signerAddr, bytes32 digest, uint256 pk) internal pure returns (bytes memory) {
        // Use vm.sign → returns (v, r, s); pack to 65-byte sig.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_QuoteMatchesFormula() public view {
        uint256 usdcIn = 1_700_000; // 1.7 USDC
        uint256 expected = _ethOut(usdcIn);
        assertEq(vault.quote(usdcIn), expected);
    }

    function test_SwapHappyPath_HidesCustomerEOA() public {
        // Use a real customer private key so the signature is valid.
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        // Mint USDC to the real customer.
        usdc.mint(customer, 1_700_000);
        // Customer approves vault to pull USDC.
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);

        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        // Relayer submits.
        uint256 recipientBalBefore = recipient.balance;
        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);

        // Recipient got ETH.
        assertEq(recipient.balance - recipientBalBefore, ethOut);
        // Customer's nonce advanced.
        assertEq(vault.nextNonce(customer), nonce + 1);
        // Customer's USDC balance dropped by usdcIn.
        assertEq(usdc.balanceOf(customer), 0);
        // Vault holds fee in USDC (sent to feeSink actually).
        assertEq(usdc.balanceOf(feeSink), (usdcIn * 5) / 10000);
    }

    function test_RevertsIfCallerNotRelayer() public {
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 1_700_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.expectRevert(ConfidentialReverseSwap.NotRelayer.selector);
        vm.prank(alice);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);
    }

    function test_RevertsOnDeadlineExpired() public {
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 1_700_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp - 1; // already expired
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.expectRevert(ConfidentialReverseSwap.DeadlineExpired.selector);
        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);
    }

    function test_RevertsOnCommitmentMismatch() public {
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 1_700_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        bytes1 viewTag = 0x07;
        bytes32 badCommit = bytes32(uint256(0xDEAD));
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, badCommit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.expectRevert(ConfidentialReverseSwap.CommitmentMismatch.selector);
        vm.prank(relayer);
        vault.swapFor(recipient, badCommit, viewTag, 0, usdcIn, deadline, nonce, sig);
    }

    function test_RevertsOnReplayedNonce() public {
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 10_000_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);

        // Second call with SAME nonce — must revert.
        vm.expectRevert(ConfidentialReverseSwap.NonceAlreadyUsed.selector);
        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);
    }

    function test_RevertsOnSlippageExceeded() public {
        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 1_700_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, ethOut + 1, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.expectRevert(abi.encodeWithSelector(ConfidentialReverseSwap.SlippageExceeded.selector, ethOut, ethOut + 1));
        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, ethOut + 1, usdcIn, deadline, nonce, sig);
    }

    function test_RevertsOnInsufficientEthReserves() public {
        // Drain vault.
        vm.prank(owner);
        vault.withdrawETH(owner, address(vault).balance);

        uint256 custPk = 0xB0B_CAFE;
        address customer = vm.addr(custPk);
        usdc.mint(customer, 1_700_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);

        uint256 usdcIn = 1_700_000;
        uint256 ethOut = _ethOut(usdcIn);
        bytes1 viewTag = 0x07;
        bytes32 commit = _commit(ethOut, viewTag);
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = vault.nextNonce(customer);
        bytes32 digest = vault.hashSwapRequest(recipient, commit, viewTag, 0, usdcIn, deadline, nonce);
        bytes memory sig = _sign(customer, digest, custPk);

        vm.expectRevert(abi.encodeWithSelector(ConfidentialReverseSwap.InsufficientReserves.selector, ethOut, 0));
        vm.prank(relayer);
        vault.swapFor(recipient, commit, viewTag, 0, usdcIn, deadline, nonce, sig);
    }

    function test_OwnerAdminPaths() public {
        // Non-owner setRate → revert.
        vm.prank(alice);
        vm.expectRevert();
        vault.setRate(2000_000000);

        vm.prank(owner);
        vault.setRate(2000_000000);
        assertEq(vault.usdcPerEth(), 2000_000000);

        vm.prank(owner);
        vault.setRelayer(alice);
        assertEq(vault.relayer(), alice);

        vm.prank(owner);
        vault.setFeeRecipient(bob);
        assertEq(vault.feeRecipient(), bob);
    }
}
