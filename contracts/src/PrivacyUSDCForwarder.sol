// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PrivacyUSDCForwarder
 * @notice Sender-hiding USDC forwarder for the UPL pilot.
 *
 *   The ERC20 `Transfer` event always emits `from = original sender`. A direct
 *   `USDC.transfer(recipient, amount)` from the customer's wallet will surface
 *   their PUBLIC wallet address on BaseScan — exactly what the UPL pilot
 *   promises to prevent.
 *
 *   This contract breaks that link. The customer:
 *
 *     1. Funds the forwarder ONE TIME (top-up tx — visible: customer →
 *        forwarder). Their PUBLIC wallet appears as the `from` of that
 *        transfer; subsequent sends do NOT.
 *
 *     2. Signs an EIP-712 intent off-chain for every subsequent send.
 *        The signature authorises `forward(token, recipient, amount)` and the
 *        relayer hot wallet submits it. msg.sender of `USDC.transfer()` is
 *        THIS contract — never the customer's wallet.
 *
 *   Each customer only ever holds the balance they deposited themselves; no
 *   pooling, no anonymity-set with strangers. Architecturally it's a
 *   single-user escrow, not a Tornado-Cash-style mixer. This is the
 *   "personal privacy wallet" pattern used by every privacy L2 (Railgun,
 *   etc.) for token sends where the user wants to hide their EOA.
 *
 *   Restoring sender privacy from on-chain observers:
 *     - Customer's PUBLIC wallet: NOT visible in any forward() call.
 *     - Recipient stealth address: visible as usual (stealth addresses are
 *       one-time, unlinkable from the recipient's meta).
 *     - Amount: visible until P3 ships confidential-note vault extension.
 *
 * SECURITY MODEL:
 *   - onlyRelayer modifier (mirrors PrivacyRelayer.sol).
 *   - Each user's balance is nonReentrant-tracked.
 *   - Replay protection via EIP-712 nonce + deadline.
 *   - Top-up + withdraw let users exit the forwarder at any time.
 */
contract PrivacyUSDCForwarder is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── EIP-712 ──────────────────────────────────────────────────────────
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant FORWARD_TYPEHASH = keccak256(
        "Forward(address token,address recipient,uint256 amount,bytes32 ephemeralKey,uint8 viewTag,uint256 nonce,uint256 deadline)"
    );

    string public constant NAME = "UPL PrivacyUSDCForwarder";
    string public constant VERSION = "1";

    // ─── State ────────────────────────────────────────────────────────────
    /// @notice Forwarder contract address allowed to call `forward()`. Defaults
    ///         to deployer (mirrors PrivacyRelayer.sol).
    address public relayer;

    /// @notice Per-(user, token) prepaid balance. The user must `deposit()`
    ///         before any `forward()` consumes their balance. Withdrawable
    ///         any time.
    mapping(address => mapping(address => uint256)) public prepaid;

    /// @notice EIP-712 nonce per caller's wallet. Replay protection.
    mapping(address => uint256) public nonces;

    /// @notice Stealth announcement payload emitted for every forward().
    event USDCForwarded(
        bytes32 indexed stealthHash,
        bytes32 indexed ephemeralKey,
        uint8 indexed viewTag,
        address token,
        address recipient,
        uint256 amount,
        address user,
        uint256 timestamp
    );

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // ─── Modifiers ─────────────────────────────────────────────────────────
    modifier onlyRelayer() {
        require(msg.sender == relayer, "Not authorised relayer");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {
        relayer = msg.sender;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Zero relayer");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    // ─── User-facing top-up / withdraw ─────────────────────────────────────
    /**
     * @notice Top up the user's prepaid balance for a given token. The user's
     *         wallet pays the visible `TransferFrom` — exactly the one visible
     *         tx in the customer's flow. After this, every subsequent send
     *         has `from = forwarder` on BaseScan.
     *
     * @param token  ERC20 token (e.g. USDC on Base = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
     * @param amount Token amount in token units (USDC: 6 decimals)
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        prepaid[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw part of the user's prepaid balance back to their wallet.
     *         Lets the customer exit the forwarder cleanly.
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(prepaid[msg.sender][token] >= amount, "Insufficient balance");
        prepaid[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ─── Signed forward ─────────────────────────────────────────────────────
    /**
     * @notice Forward `amount` of `token` from the forwarder's balance to
     *         `recipient`. Caller must be the authorised relayer — it is
     *         responsible for verifying the user's EIP-712 signature off-chain
     *         before submitting.
     *
     *         This is the on-chain half of the flow that hides the customer's
     *         wallet. The relayer passes the `user` (signatory) + (token,
     *         recipient, amount, ephemeralKey, viewTag, nonce, deadline) plus
     *         the user's EIP-712 signature it already verified.
     *
     * @param user         EIP-712 signatory (the customer's wallet that paid
     *                     the top-up). Their wallet NEVER appears as the
     *                     on-chain `from` — the forwarder does.
     * @param token        ERC20 token address.
     * @param recipient    Stealth recipient.
     * @param amount       Amount in token units.
     * @param ephemeralKey 32-byte ephemeral commitment for the announce.
     * @param viewTag      1-byte EIP-5564 tag.
     * @param nonce        EIP-712 nonce for replay protection.
     * @param deadline     After this Unix timestamp the intent expires.
     */
    function forward(
        address user,
        address token,
        address recipient,
        uint256 amount,
        bytes32 ephemeralKey,
        uint8 viewTag,
        uint256 nonce,
        uint256 deadline
    ) external onlyRelayer nonReentrant {
        require(block.timestamp <= deadline, "Expired intent");
        require(nonce == nonces[user]++, "Bad nonce");
        require(amount > 0, "Zero amount");
        require(prepaid[user][token] >= amount, "Insufficient prepaid");
        require(recipient != address(0), "Zero recipient");
        require(recipient != address(this), "Self recipient");

        // Consume the user's balance.
        prepaid[user][token] -= amount;

        // Forward USDC (the on-chain Transfer has `from = forwarder`,
        // never `from = user`). msg.sender here IS the forwarder.
        IERC20(token).safeTransfer(recipient, amount);

        emit USDCForwarded(
            keccak256(abi.encodePacked(recipient)),
            ephemeralKey,
            viewTag,
            token,
            recipient,
            amount,
            user,
            block.timestamp
        );
    }

    // ─── EIP-712 helpers (off-chain signers in the wallet + browser) ──────
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(NAME)), keccak256(bytes(VERSION)), block.chainid, address(this))
        );
    }

    function forwardTypehash() public pure returns (bytes32) {
        return FORWARD_TYPEHASH;
    }
}
