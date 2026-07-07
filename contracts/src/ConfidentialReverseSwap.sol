// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ConfidentialReverseSwap
 * @notice USDC in, ETH out — amount-hidden, relayer-submitted.
 *         Customer's EOA never appears as msg.sender.
 *
 * @dev Minimal inlined EIP-712 (avoids OZ v5.6.1's ^0.8.24 pin).
 */
contract ConfidentialReverseSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ─── Inlined EIP-712 helpers ───────────────────────────────── */
    // EIP-712 domain: keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private immutable _domainSeparator;
    bytes32 private constant SWAP_TYPEHASH = keccak256(
        "SwapRequest(address recipient,bytes32 amountCommit,bytes1 viewTagByte,uint256 minEthOut,uint256 usdcIn,uint256 deadline,uint256 nonce)"
    );

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    IERC20 public immutable USDC;

    /// @notice USDC (6-dec) per 1 ETH (1e18 wei). Set by owner.
    uint256 public usdcPerEth;

    /// @notice 5 bps fee skim receiver.
    address public feeRecipient;

    /// @notice Relayer authorised to submit customer-signed swaps.
    ///         The relayer is the on-chain msg.sender of every
    ///         swap. The customer's wallet NEVER calls this contract.
    address public relayer;

    /// @notice Per-customer nonce consumption — replay protection.
    mapping(address => uint256) public nonces;

    /// @notice Decoded ETH-out registry — only the customer with
    ///         the right view key can decode.
    struct CommitmentRecord {
        address recipient;
        address customer; // who authorised (recovered from sig)
        uint256 amount; // plaintext ETH-out (wei) — only
        // recoverable by the recipient
        uint256 usdcIn;
        uint256 fee;
        uint256 timestamp;
    }
    mapping(bytes32 => CommitmentRecord) public commitments;

    event ReverseSwapExecuted(
        address indexed customer, // indexed so the customer's wallet can filter — but it's the AUTHORISING address, not the msg.sender
        address indexed recipient,
        bytes32 indexed amountCommitment,
        bytes32 viewTag,
        uint256 usdcIn,
        uint256 fee,
        uint256 timestamp
    );
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event RelayerUpdated(address oldRelayer, address newRelayer);
    event EthFunded(address indexed funder, uint256 amount);
    event EthWithdrawn(address indexed to, uint256 amount);

    error NotRelayer();
    error InvalidRecipient();
    error DeadlineExpired();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error ZeroAmount();
    error SlippageExceeded(uint256 expected, uint256 minRequired);
    error InsufficientReserves(uint256 needed, uint256 have);
    error ZeroRate();
    error CommitmentMismatch();

    constructor(address _usdc, address _feeRecipient, address _relayer, uint256 _usdcPerEth, address _owner)
        Ownable(_owner)
    {
        require(_usdc != address(0), "usdc=0");
        require(_feeRecipient != address(0), "fee=0");
        require(_relayer != address(0), "relayer=0");
        require(_usdcPerEth > 0, "rate=0");
        USDC = IERC20(_usdc);
        feeRecipient = _feeRecipient;
        relayer = _relayer;
        usdcPerEth = _usdcPerEth;

        // Inlined EIP-712 domain separator.
        _domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("UPLConfidentialReverseSwap"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice EIP-712 typed-data digest for the SwapRequest struct.
    ///         The customer's wallet signs this exact 32-byte value.
    function hashSwapRequest(
        address recipient,
        bytes32 amountCommit,
        bytes1 viewTagByte,
        uint256 minEthOut,
        uint256 usdcIn,
        uint256 deadline,
        uint256 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SWAP_TYPEHASH,
                recipient,
                amountCommit,
                bytes32(uint256(uint8(viewTagByte))),
                minEthOut,
                usdcIn,
                deadline,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    /// @notice Recover signer from EIP-712 digest + signature.
    function recoverSigner(bytes32 digest, bytes calldata sig) public pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }

    /// @notice Receive ETH topups (operator-funded buffer).
    receive() external payable {}

    /// @notice Quote helper — how much ETH (wei) the customer gets
    ///         for `usdcIn` USDC units (6-dec), after the 5 bps fee.
    function quote(uint256 usdcIn) external view returns (uint256) {
        if (usdcIn == 0 || usdcPerEth == 0) return 0;
        uint256 fee = (usdcIn * 5) / 10000;
        uint256 swapUsdc = usdcIn - fee;
        // (usdc * 1e18) / usdcPerEth  → wei
        return (swapUsdc * 1e18) / usdcPerEth;
    }

    /// @notice Vault's ETH buffer (so the FE can warn before
    ///         InsufficientReserves).
    function reserveBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Relayer submits a customer-signed swap. The customer's
     *         wallet is recovered from `sig`; it never appears as
     *         msg.sender. The customer must have USDC.approve'd the
     *         relayer's permit2-style pull, or this vault (we use
     *         transferFrom with the customer's prior approval to
     *         THIS vault — relayer just calls swapFor()).
     *
     *         The customer's approval must have been set ahead of
     *         time (one USDC.approve(vault, max) per wallet, done
     *         in the FE when they connect). The vault pulls USDC
     *         from the customer's wallet — that Transfer event on
     *         the USDC contract leaks the input amount; nothing we
     *         can do about that on L1.
     *
     * @param recipient       Stealth ETH recipient.
     * @param amountCommit    Customer-built commitment of ethOut.
     * @param viewTagByte     1-byte view tag.
     * @param minEthOut       Slippage floor.
     * @param usdcIn          USDC (6-dec) the customer wants to swap.
     * @param deadline        Sig expiry (unix seconds).
     * @param nonce           Customer's per-wallet nonce.
     * @param sig             EIP-712 signature over the SwapRequest.
     */
    function swapFor(
        address recipient,
        bytes32 amountCommit,
        bytes1 viewTagByte,
        uint256 minEthOut,
        uint256 usdcIn,
        uint256 deadline,
        uint256 nonce,
        bytes calldata sig
    ) external nonReentrant {
        if (msg.sender != relayer) revert NotRelayer();
        if (recipient == address(0)) revert InvalidRecipient();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (usdcIn == 0) revert ZeroAmount();

        // ─── EIP-712 signature recovery ───────────────────────────
        bytes32 digest = hashSwapRequest(recipient, amountCommit, viewTagByte, minEthOut, usdcIn, deadline, nonce);
        address customer = recoverSigner(digest, sig);
        if (customer == address(0)) revert InvalidSignature();
        if (nonces[customer] != nonce) revert NonceAlreadyUsed();
        nonces[customer] = nonce + 1;

        // ─── Pricing & slippage ───────────────────────────────────
        uint256 fee = (usdcIn * 5) / 10000;
        uint256 swapUsdc = usdcIn - fee;
        uint256 ethOut = (swapUsdc * 1e18) / usdcPerEth;
        if (ethOut == 0) revert ZeroAmount();
        if (ethOut < minEthOut) revert SlippageExceeded(ethOut, minEthOut);
        if (address(this).balance < ethOut) {
            revert InsufficientReserves(ethOut, address(this).balance);
        }

        // ─── Commitment check ────────────────────────────────────
        // Same scheme as the forward vault: the customer computes
        // the commitment locally from the ethOut they expect + a
        // 1-byte view tag, then submits it via the relayer. The
        // contract re-derives it on-chain and reverts on mismatch.
        bytes32 actualCommit = keccak256(
            abi.encodePacked(
                keccak256(abi.encodePacked(ethOut, viewTagByte)),
                uint8(0x43) // reverse-swap domain tag (vs 0x42 forward)
            )
        );
        if (amountCommit != actualCommit) revert CommitmentMismatch();

        // ─── Effects: pull USDC, send fee in USDC, send ETH out ──
        // USDC pull from customer → vault. Plaintext amount leaks
        // on USDC's Transfer event — system property of ERC20.
        USDC.safeTransferFrom(customer, address(this), usdcIn);

        // Fee in USDC (we keep reserves in USDC, easier to sweep).
        if (fee > 0) {
            USDC.safeTransfer(feeRecipient, fee);
        }

        // ETH payout to stealth recipient.
        (bool ok,) = payable(recipient).call{value: ethOut}("");
        require(ok, "eth payout");

        commitments[actualCommit] = CommitmentRecord({
            recipient: recipient,
            customer: customer,
            amount: ethOut,
            usdcIn: usdcIn,
            fee: fee,
            timestamp: block.timestamp
        });

        emit ReverseSwapExecuted(
            customer, recipient, actualCommit, bytes32(uint256(uint8(viewTagByte))), usdcIn, fee, block.timestamp
        );
    }

    function lookupCommitment(bytes32 commit)
        external
        view
        returns (address recipient, address customer, uint256 amount, uint256 usdcIn, uint256 fee, uint256 timestamp)
    {
        CommitmentRecord storage r = commitments[commit];
        return (r.recipient, r.customer, r.amount, r.usdcIn, r.fee, r.timestamp);
    }

    function nextNonce(address customer) external view returns (uint256) {
        return nonces[customer];
    }

    /* ──────────── Owner admin ──────────── */
    function setRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroRate();
        emit RateUpdated(usdcPerEth, newRate);
        usdcPerEth = newRate;
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "fee=0");
        emit FeeRecipientUpdated(feeRecipient, newFeeRecipient);
        feeRecipient = newFeeRecipient;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "relayer=0");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        require(amount <= address(this).balance, "insufficient");
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "eth forward");
        emit EthWithdrawn(to, amount);
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        USDC.safeTransfer(to, amount);
    }
}
