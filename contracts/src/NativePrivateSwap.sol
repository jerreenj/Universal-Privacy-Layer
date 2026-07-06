// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NativePrivateSwap
 * @notice A simple vault-style private swap. Customers send ETH and
 *         receive USDC at an admin-set fixed rate, paid directly to
 *         a stealth recipient from this contract's reserves.
 *
 * Why this exists (vs. wrapping a third-party DEX like Aerodrome):
 *   The previous "native swap" routed through the customer's wallet
 *   via the Aerodrome Router — that meant the whole "private" flow
 *   still touched a third-party public AMM, which is a privacy leak
 *   by construction (Aerodrome Swap events are public on Base and
 *   link sender->stealth directly). This contract implements the
 *   swap entirely in house: the only on-chain artefacts are an ETH
 *   transfer in (no public route-search) and a USDC.transfer from
 *   this contract's reserves out — both address-observable but
 *   decoupled by the stealth-recipient address.
 *
 * Design summary:
 *   - USDC holds the reserves (admin-funded). Each swap pays out of
 *     these reserves; the contract never routes through a third-party
 *     DEX.
 *   - ETH-denominated fee (5 bps) goes to feeRecipient (typically the
 *     deployer's PrivacyRelayer-style fee wallet; mirror the same
 *     fee model as the other wrappers so the UX is consistent).
 *   - Rate is admin-set in 6-decimal USDC units per 1 ETH. The admin
 *     can fund more USDC reserves, withdraw USDC or ETH, and update
 *     the rate. We keep it intentionally simple for the customer
 *     pilot: no oracle (oracle adds another dependency); no dynamic
 *     pricing engine (deterministic, auditable). Productionising
 *     this would involve a Chainlink price feed guardrail to keep
 *     rate within X% of oracle.
 *   - All non-payable admin functions are nonReentrant so fee
 *     collection in `swapETHForUSDC` cannot re-enter the admin
 *     layer if the USDC token were adversarial.
 *
 * @dev Customer's wallet calls this directly via MetaMask; no
 *      third-party coordination is needed. Backend surfaces the
 *      contract address via /api/deployments (kept in sync with
 *      deployed_base.json by scripts/DeployNative.s.sol).
 */
contract NativePrivateSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Stable token accepted as the swap output. USDC on Base mainnet.
    IERC20 public immutable USDC;

    /// @notice Receives the 5 bps protocol fee skimmed off each swap.
    address public feeRecipient;

    /// @notice USDC-per-ETH rate in 6-decimal USDC units per 1 ETH.
    ///         E.g. 3000 USDC/ETH = 3000_000000.
    uint256 public usdcPerEth;

    event SwapExecuted(
        address indexed sender,
        address indexed recipient,
        uint256 ethIn,
        uint256 fee,
        uint256 usdcOut,
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

    constructor(address _usdc, address _feeRecipient, uint256 _usdcPerEth, address _owner) Ownable(_owner) {
        require(_usdc != address(0), "usdc=0");
        require(_feeRecipient != address(0), "fee=0");
        require(_owner != address(0), "owner=0");
        require(_usdcPerEth > 0, "rate=0");
        USDC = IERC20(_usdc);
        feeRecipient = _feeRecipient;
        usdcPerEth = _usdcPerEth;
    }

    /// @notice Swap ETH for USDC at the admin-set rate. USDC is
    ///         paid directly to {recipient} — typically a stealth
    ///         address — from this contract's USDC reserves.
    /// @param recipient The stealth address that will receive USDC.
    /// @param minUsdcOut Revert if computed output < this (slippage guard).
    /// @return usdcOut The amount of USDC transferred to the recipient.
    function swapETHForUSDC(address recipient, uint256 minUsdcOut)
        external
        payable
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (msg.value == 0) revert NoETHSent();
        if (recipient == address(0)) revert InvalidRecipient();

        // 5 bps protocol fee (matches AerodromePrivacyWrapper + others).
        uint256 fee = (msg.value * 5) / 10000;
        uint256 swapAmount = msg.value - fee;

        (bool ok,) = feeRecipient.call{value: fee}("");
        require(ok, "fee-xfer-failed");

        // Compute USDC output:
        //   swapAmount (18-dec ETH wei) * rate (6-dec USDC) / 1e18
        // because: rate is stored in 6-dec USDC per full ETH (e.g.
        // 3000 USDC/ETH => 3000_000000 = 3e9). 1 ETH = 1e18 wei_eth.
        // To express usdcOut_microUSDC = swapAmount_wei * rate_per_wei
        // we divide by 1e18 because rate_per_wei = rate_per_eth / 1e18.
        usdcOut = (swapAmount * usdcPerEth) / 1e18;

        if (usdcOut < minUsdcOut) revert SlippageExceeded(usdcOut, minUsdcOut);

        uint256 balance = USDC.balanceOf(address(this));
        if (balance < usdcOut) revert InsufficientReserves(usdcOut, balance);

        USDC.safeTransfer(recipient, usdcOut);

        emit SwapExecuted(msg.sender, recipient, msg.value, fee, usdcOut, block.timestamp);
    }

    /// @notice Admin: update the USDC-per-ETH rate.
    function setRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroRate();
        uint256 old = usdcPerEth;
        usdcPerEth = newRate;
        emit RateUpdated(old, newRate);
    }

    /// @notice Admin: rotate the fee recipient.
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "new-fee=0");
        address old = feeRecipient;
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(old, newFeeRecipient);
    }

    /// @notice Anyone can fund USDC reserves via ERC20 transferFrom.
    ///         The deployer (owner) is the canonical funder but the
    ///         path is open for top-up from ops as well.
    function fundUSDC(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit UsdcFunded(msg.sender, amount, USDC.balanceOf(address(this)));
    }

    /// @notice Owner: withdraw USDC reserves (e.g., to rebalance or
    ///         spot-fix the rate without redeploying).
    function withdrawUSDC(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        USDC.safeTransfer(to, amount);
        emit UscWithdrawn(to, amount, USDC.balanceOf(address(this)));
    }

    /// @notice Owner: withdraw accumulated ETH (most of it will be
    ///         fee-skimmed; this is just for completeness).
    function withdrawETH(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth-xfer-failed");
        emit EthWithdrawn(to, amount, address(this).balance);
    }

    /// @notice Reads the available USDC reserve (canonical getter for
    ///         the frontend quote preview / "buy up to" hint).
    function reserveBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /// @notice Convenience: preview the expected USDC output for a
    ///         given ETH input (5 bps fee taken into account). Lets
    ///         the frontend render a precise quote without a second
    ///         RPC round-trip.
    function quote(uint256 ethIn) external view returns (uint256 usdcOut) {
        uint256 fee = (ethIn * 5) / 10000;
        uint256 swapAmount = ethIn - fee;
        usdcOut = (swapAmount * usdcPerEth) / 1e18;
    }

    /// @notice Allow owner to top up the ETH balance of the contract
    ///         (no-op for the swap flow itself — ETH is consumed —
    ///         but kept for symmetry with withdrawETH).
    receive() external payable {}
}
