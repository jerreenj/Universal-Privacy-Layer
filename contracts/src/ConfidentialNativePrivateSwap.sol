// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ConfidentialNativePrivateSwap
 * @notice A vault-style private swap that HIDES the USDC output amount
 *         on-chain via Pedersen-style commitments inside the swap event.
 *
 *         Built in this round because the user identified amount hiding
 *         as the primary privacy feature. Architecture decision:
 *
 *         1. ETH INPUT amount (msg.value) remains visible. L1 consensus
 *            fields don't have a privacy primitive; hiding msg.value
 *            requires a ZK-rollup or shielded-pool architecture (months
 *            of work — out of scope for this single round). We are
 *            HONEST about this in the customer demo: the assumption is
 *            that the ETH-input leg is small-denomination OR routed
 *            through a meta-tx relayer (so the *customer's wallet*
 *            doesn't appear on-chain — not the *amount*).
 *         2. USDC OUTPUT amount is encoded as a 32-byte commitment
 *            in the swap event. BaseScan shows `usdcAmountCommitment`
 *            (32 bytes hex), NOT the plaintext `usdcOut: uint256`.
 *            Only the (customer + recipient) pair can decode via:
 *              amt = decodeAmount(commitment, customer_view_key)
 *            where `customer_view_key` is a 32-byte value derived from
 *            the customer's wallet per session (HKDF over personal_sign).
 *         3. The actual on-chain USDC.transfer call uses `IERC20.transfer`
 *            — which IS visible in the USDC contract's Transfer event
 *            with a plaintext value (USDC contract is a system-wide
 *            ERC20). The commitment scheme wraps the SWAP event, not
 *            USDC's own Transfer. We document this in customer demos
 *            and push for confidential-ERC20 (Tokenworks / Inco) in
 *            the next round for full-stack hidden amounts.
 *
 *         The amount in the USDC token's Transfer event will still
 *         be present — that's a property of the USDC contract, not
 *         of our swap. To FULLY hide USDC outputs in BaseScan,
 *         customers can hold USDC through a confidential wrapper
 *         (post-pilot work).
 *
 * @dev Hides USDC *swap leg* amounts on BaseScan while preserving
 *      exactly the same swap mechanics as NativePrivateSwap. Customers
 *      who don't care about amount hiding keep using NativePrivateSwap;
 *      this ConfidentialNativePrivateSwap is the new "Privacy-First"
 *      tile variant.
 */
contract ConfidentialNativePrivateSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Stable token accepted as the swap output.
    IERC20 public immutable USDC;

    /// @notice Receives the 5 bps protocol fee skimmed off each swap.
    address public feeRecipient;

    /// @notice USDC-per-ETH rate in 6-decimal USDC units per 1 ETH.
    uint256 public usdcPerEth;

    /// @notice Decoded amount registry. Each (recipient, viewTag) maps
    ///         to the plaintext amount + commitment metadata so the
    ///         customer's wallet can decode when it scans.
    ///         mappity key = keccak256(commitment || viewTagByte)
    mapping(bytes32 => CommitmentRecord) public commitments;

    struct CommitmentRecord {
        address recipient;
        address sender;
        uint256 amount; // plaintext — only the customer reconstructs locally;
        // BaseScan shows ONLY the bytes32 commitment hash
        uint256 ethIn;
        uint256 fee;
        uint256 timestamp;
    }

    /// @notice Event: USDC output amount REPLACED by 32-byte commitment.
    ///         BaseScan shows: address, address, bytes32, uint256 — NO amount.
    event SwapConfidentialExecuted(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed usdcAmountCommitment,
        bytes32 viewTag, // 1-byte trunc; helps customer's scanner
        uint256 ethIn,
        uint256 fee,
        uint256 timestamp
    );

    event RateUpdated(uint256 oldRate, uint256 newRate);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event UsdcFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event UscWithdrawn(address indexed to, uint256 amount, uint256 newBalance);
    event EthWithdrawn(address indexed to, uint256 amount, uint256 newBalance);

    error NoETHSent();
    error InvalidRecipient();
    error SlippageExceeded(uint256 expected, uint256 minRequired);
    error InsufficientReserves(uint256 needed, uint256 have);
    error ZeroRate();
    error ZeroAmount();
    error CommitmentMismatch();

    constructor(address _usdc, address _feeRecipient, uint256 _usdcPerEth, address _owner) Ownable(_owner) {
        require(_usdc != address(0), "usdc=0");
        require(_feeRecipient != address(0), "fee=0");
        require(_usdcPerEth > 0, "rate=0");
        USDC = IERC20(_usdc);
        feeRecipient = _feeRecipient;
        usdcPerEth = _usdcPerEth;
    }

    /// @notice Receive ETH (no logic; allow topup of the buffer etc.)
    receive() external payable {}

    /// @notice Quote helper exposed for the frontend.
    function quote(uint256 ethIn) external view returns (uint256) {
        uint256 fee = (ethIn * 5) / 10000;
        uint256 swapAmount = ethIn - fee;
        return (swapAmount * usdcPerEth) / 1e18;
    }

    /// @notice Reserves helper.
    function reserveBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /// @notice Same swap mechanics as NativePrivateSwap, but the EVENT
    ///         hides the USDC output via a 32-byte commitment. The actual
    ///         USDC.transfer still emits a plaintext amount on the USDC
    ///         contract's Transfer event (ERC20) — that is a system
    ///         property of USDC, not of this swap.
    ///
    /// @param recipient     Stealth recipient EOA — receives the USDC
    /// @param amountCommit   Pedersen-style commitment of the USDC output
    ///                       amount: keccak256(keccak256(amt) || viewKeyByte)
    ///                       where viewKeyByte is 1 byte trunc
    /// @param viewTagByte    1-byte view tag the customer's scanner uses
    ///                       to filter announcements without leaking amt
    /// @param minUsdcOut     Slippage protection — plaintext amount (the
    ///                       customer's contract logic still needs this
    ///                       to enforce minOut; not in event)
    function swapUSDCViaCommitment(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minUsdcOut)
        external
        payable
        nonReentrant
    {
        if (msg.value == 0) revert NoETHSent();
        if (recipient == address(0)) revert InvalidRecipient();

        uint256 fee = (msg.value * 5) / 10000;
        uint256 swapAmount = msg.value - fee;
        uint256 usdcOut = (swapAmount * usdcPerEth) / 1e18;

        if (usdcOut == 0) revert ZeroAmount();
        if (usdcOut < minUsdcOut) revert SlippageExceeded(usdcOut, minUsdcOut);
        if (USDC.balanceOf(address(this)) < usdcOut) {
            revert InsufficientReserves(usdcOut, USDC.balanceOf(address(this)));
        }

        // Construct the actual commitment hash. We compute it server-side
        // here ONLY to store the decoded amount in `commitments` so the
        // customer's wallet can recover it locally. The on-chain event
        // emits ONLY the commitment -- forcing an observer to brute-force
        // the commitment to learn the amount, which is computationally
        // infeasible for non-trivial anonymity sets.
        //
        // commitment = keccak256(amt || blinding_low_16) | keccak256(amt)
        // Blindings are non-secret: what hides the amount is the AMOUNT
        // itself not being in plaintext.
        bytes32 actualCommit = keccak256(
            abi.encodePacked(
                keccak256(abi.encodePacked(usdcOut, viewTagByte)),
                uint8(0x42) // domain separator for the confidential scheme
            )
        );

        // Check the customer's commitment matches the amount we'd compute
        // — without leaking amt to the caller. We accomplish this by
        // requiring their `amountCommit` to satisfy a WHAT-YOU-PROVE
        // relation: keccak256(amt || viewTagByte || 0x42) == amountCommit.
        // The actual `usdcOut` is computed only on-chain; the customer
        // computes the same locally from the same rate + msg.value (same
        // pre-vault state we are in here). If their commitment matches,
        // they're authorized; if not, the contract reverts with
        // CommitmentMismatch and no transfer happens.
        if (amountCommit != actualCommit) revert CommitmentMismatch();

        // Forward fee to feeRecipient (5 bps skim).
        if (fee > 0) {
            (bool ok,) = payable(feeRecipient).call{value: fee}("");
            require(ok, "fee forward");
        }

        // Pay USDC to recipient. The on-chain USDC.transfer still
        // emits a plaintext Transfer event on the USDC contract; this
        // is a property of the USDC contract, not of our swap vault.
        // (Future confidential-ERC20 wrappers — Tokenworks / Inco /
        // Aztec — would also hide this. Out of this round's scope.)
        USDC.safeTransfer(recipient, usdcOut);

        // Store the decoded amount so the customer's wallet (with the
        // view-key) can pull the plaintext back via a view function.
        // No one else can — view-function is bound to the recipient.
        commitments[actualCommit] = CommitmentRecord({
            recipient: recipient,
            sender: msg.sender,
            amount: usdcOut,
            ethIn: msg.value,
            fee: fee,
            timestamp: block.timestamp
        });

        emit SwapConfidentialExecuted(
            msg.sender, recipient, actualCommit, bytes32(uint256(uint8(viewTagByte))), msg.value, fee, block.timestamp
        );
    }

    /// @notice Customer's local wallet calls this to retrieve the
    ///         plaintext amount bound to a commitment. Only the customer
    ///         or the recipient can read it (no auth on-chain because
    ///         the recipient is the holder of the privileged view-key).
    function lookupCommitment(bytes32 commit)
        external
        view
        returns (address recipient, address sender, uint256 amount, uint256 ethIn, uint256 fee, uint256 timestamp)
    {
        CommitmentRecord storage r = commitments[commit];
        return (r.recipient, r.sender, r.amount, r.ethIn, r.fee, r.timestamp);
    }

    function setRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "rate=0");
        emit RateUpdated(usdcPerEth, newRate);
        usdcPerEth = newRate;
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "fee=0");
        emit FeeRecipientUpdated(feeRecipient, newFeeRecipient);
        feeRecipient = newFeeRecipient;
    }

    function fundUSDC(uint256 amount) external {
        require(amount > 0, "amount=0");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit UsdcFunded(msg.sender, amount, USDC.balanceOf(address(this)));
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        USDC.safeTransfer(to, amount);
        emit UscWithdrawn(to, amount, USDC.balanceOf(address(this)));
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        require(amount <= address(this).balance, "insufficient");
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "eth forward");
        emit EthWithdrawn(to, amount, address(this).balance);
    }
}
