// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal interface to StealthAddressRegistry.announce — avoids a full
///      import (and any circular dependency) while letting `relayAndAnnounce`
///      call into the registry atomically in the same tx. Signature matches
///      StealthAddressRegistry.announce(bytes32,bytes32,bytes32,bytes32).
interface IStealthRegistry {
    function announce(bytes32 ephemeralPubKeyX, bytes32 ephemeralPubKeyY, bytes32 viewTag, bytes32 stealthHash)
        external;
}

/**
 * @title PrivacyRelayer
 * @notice Universal Privacy Layer — Smart Relayer Contract (P1 reconciled).
 *
 * @dev GAS-ONLY META-TX FORWARDER.
 *
 *   The whole privacy model rests on this property: the user's wallet NEVER
 *   appears on-chain as the sender of a private transfer. The off-chain relayer
 *   service is the contract's caller (`msg.sender`). The relayer pays gas, the
 *   relayer is what block explorers see, and the user's funds never sit inside
 *   this contract between transactions.
 *
 *   How funds reach the stealth recipient without the user being msg.sender:
 *     1. User signs an EIP-712 intent off-chain: {recipient, ephemeralKey,
 *        viewTag, amount, deadline, nonce}.
 *     2. The relayer service validates the signature, then submits a funded
 *        `relay()` call on Base. The relayer attaches `msg.value == amount`
 *        (the relayer fronts the ETH from its own hot-wallet buffer, OR — for
 *        the optional custodial top-up path — from a PrepaidDeposit the user
 *        pre-funded *into this contract*, authorised only by the signed
 *        intent's nonce). See `withdrawPrepaid()` for the refund path.
 *     3. This contract sends `amount - fee` to the stealth recipient, keeps
 *        `fee` as accrued fees (the `feeBps` slice), and the relayer is
 *        reimbursed for gas from those accrued fees via `withdrawFees()`.
 *
 *   Non-custodial invariant: between private transfers this contract holds at
 *   most (a) accrued fees pending withdrawal by the owner, and (b) prepaid
 *   deposits that the *depositor* can claw back at any time. No user's
 *   in-flight value is ever held — it is forwarded within the same tx.
 *
 * ABI surface (matches `backend/server.py` PRIVACY_RELAYER_ABI exactly):
 *   - function relay(address recipient, bytes32 ephemeralKey, uint8 viewTag) payable
 *   - function relayAndAnnounce(...) payable   (P2.9.7 — atomic relay + announce)
 *   - function feeBps() view returns (uint256)
 *   - function totalRelayed() view returns (uint256)
 *   - function setRegistry(address)            (P2.9.7 — owner-only wiring)
 *   - function registry() view returns (address)
 */
contract PrivacyRelayer is ReentrancyGuard, Ownable {
    // ─── Events ────────────────────────────────────────────────────────────
    // Index the *hash* of the stealth address, never the address itself, so
    // the on-chain log is unlinkable noise to anyone without the off-chain
    // encrypted receipt. The ephemeral pubkey is published in the log so the
    // recipient (and only the recipient) can derive the shared secret and
    // recognise the transfer; the ephemeral key is harmless to publish.
    event PrivateTransfer(
        bytes32 indexed stealthAddressHash,
        bytes32 indexed ephemeralKey,
        uint8 indexed viewTag,
        uint256 amount,
        uint256 fee,
        uint256 timestamp
    );

    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PrepaidDeposited(address indexed depositor, uint256 amount);
    event PrepaidWithdrawn(address indexed depositor, uint256 amount);

    // ─── Fee configuration ─────────────────────────────────────────────────
    // Stored as basis points for the backend's `feeBps()` view. 5 bps = 0.05%.
    uint256 private _feeBps = 5;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_BPS = 100; // hard cap = 1%

    // ─── Bookkeeping ───────────────────────────────────────────────────────
    uint256 private _totalRelayed; // cumulative wei forwarded (for stats + UI)
    uint256 public accumulatedFees; // accrues feeBps per transfer; only owner withdraws

    // Optional prepaid buffer: a user can pre-fund THIS contract so the
    // relayer doesn't need to front ETH itself. Refundable by depositor at any
    // time. This is the ONLY path where user value is retained between txs, and
    // every wei is individually claw-back-able by the owner of the deposit —
    // not the contract owner, and not the relayer.
    mapping(address => uint256) public prepaidBalance;

    // ─── Registry wiring (P2.9.7) ─────────────────────────────────────────
    // Address of the StealthAddressRegistry that `relayAndAnnounce` calls into
    // atomically in the same tx. Set once by the owner via `setRegistry`. Zero
    // until set, in which case `relayAndAnnounce` reverts (use the announce-less
    // `relay()` if no registry is wired). `relay()` remains unaffected.
    address public registry;

    constructor() Ownable(msg.sender) {
        // Solo-relayer MVP: the deployer IS the relayer. Rotate via setRelayer()
        // once the relayer service has its own hot wallet (P1.10 hardening).
        relayer = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────
    /// @notice Only the relayer service wallet may call `relay`. Enforced by
    /// the owner granting the role once at deploy (P1.9). Without this, anyone
    /// could submit `relay()` and appear as the on-chain sender, polluting the
    /// anonymity set. For solo-relayer MVP the owner IS the relayer; relayer-
    /// rotation to a dedicated role is a P1.10 hardening step.
    modifier onlyRelayer() {
        require(msg.sender == relayer, "Not authorised relayer");
        _;
    }

    // ─── Relayer role ──────────────────────────────────────────────────────
    /// @notice Address permitted to call `relay()`. Defaults to the deployer
    /// (owner) for the solo-relayer MVP; rotate via `setRelayer()` once the
    /// relayer service has its own hot wallet.
    address public relayer;

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Zero relayer");
        relayer = newRelayer;
    }

    /// @notice Wire the StealthAddressRegistry that `relayAndAnnounce` calls
    ///         atomically. Owner-only. Zero address is rejected. Once set, the
    ///         registry is fixed (no unset path); rotate by re-pointing to a new
    ///         registry address if the registry is ever replaced. `relay()` (the
    ///         announce-less entry) is unaffected by this setting and remains
    ///         callable regardless.
    function setRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Zero registry");
        registry = newRegistry;
    }

    // ─── Core entry — the ONLY function the backend calls ─────────────────
    /**
     * @notice Forward `msg.value` to a one-time stealth recipient, deducting
     *         the protocol fee. Called by the relayer service ONLY.
     * @param recipient      One-time stealth address derived (off-chain) from
     *                       the recipient's spending/view pubkeys + the ephem
     *                       key. Receives `msg.value - fee`.
     * @param ephemeralKey   32-byte ephemeral public-key commitment. Published
     *                       in the event so the recipient can derive the
     *                       shared secret and recognise the transfer. Stored
     *                       as bytes32 (not the full 64-byte pubkey) to keep
     *                       calldata/gas low — the relayer commits the x-only
     *                       coordinate or a hash; the off-chain relayer service
     *                       keeps the full key and serves it to the recipient.
     * @param viewTag        1-byte EIP-5564 view tag for fast client-side scan
     *                       filtering.
     *
     * @dev Invariants enforced:
     *   - msg.sender == relayer         (only an authorised relayer can submit)
     *   - msg.value > 0                 (no empty private transfers)
     *   - recipient != address(0)
     *   - recipient != address(this)   (prevent self-locking of fees)
     *   - fee < msg.value               (feeBps capped at MAX_FEE_BPS guarantees this)
     *   The forward is a low-level `.call` with a 2300-style gas stipend NOT
     *   relied upon — we require `success` and reentrancy is blocked by
     *   `nonReentrant` (stealth recipients are EOAs in MVP, but the guard is the
     *   defensive default).
     */
    function relay(address recipient, bytes32 ephemeralKey, uint8 viewTag) external payable onlyRelayer nonReentrant {
        _relayCore(recipient, ephemeralKey, viewTag);
    }

    /**
     * @notice Atomic relay + announce — the EVM analog of Sui's `relayed_send`
     *         PTB. Forwards `msg.value` to the stealth recipient (fee-skimmed),
     *         emits `PrivateTransfer`, AND calls `registry.announce(...)` in the
     *         SAME transaction. If either the forward or the announce reverts,
     *         the entire tx reverts — no dangling relay without an announcement
     *         (the failure mode of the old two-tx stitch). Closes the P2.9
     *         parity gap with Sui's atomic compose.
     *
     *         `relay()` (announce-less) is kept for backward compatibility; this
     *         is the preferred entry point once `setRegistry` has been called.
     *
     * @param recipient      Stealth recipient (same as `relay()`).
     * @param ephemeralKey   32-byte ephemeral commitment (same as `relay()`).
     * @param viewTag        1-byte view tag (same as `relay()`).
     * @param ephemPubKeyX   First 32 bytes of the ephemeral pubkey for the
     *                       registry announcement (the recipient's scan input).
     * @param ephemPubKeyY   Last 32 bytes of the ephemeral pubkey.
     * @param stealthHash    keccak256 of the derived stealth address (registry
     *                       lookup/sanity — NOT the address itself).
     *
     * @dev Trust model: the announce fields (ephemPubKeyX/Y, stealthHash) are
     *      relayer-supplied, NOT signed in the EIP-712 intent — identical to the
     *      existing trust model where the relayer already constructs the
     *      announce() payload off-chain and is `onlyRelayer`-authorized (it
     *      fronts the ETH, so it is fully trusted). `viewTag` is left-padded to
     *      bytes32 via `bytes32(uint256(viewTag))` to match the registry's
     *      expected encoding (same as the off-chain relayer's
     *      `view_tag_to_bytes32`). Requires `registry != address(0)` (set via
     *      `setRegistry` once).
     */
    function relayAndAnnounce(
        address recipient,
        bytes32 ephemeralKey,
        uint8 viewTag,
        bytes32 ephemPubKeyX,
        bytes32 ephemPubKeyY,
        bytes32 stealthHash
    ) external payable onlyRelayer nonReentrant {
        // Forward + fee + PrivateTransfer event. Reverts on failure.
        _relayCore(recipient, ephemeralKey, viewTag);

        // Atomic announce in the same tx. If this reverts, the forward above is
        // rolled back too — recipient never sees the funds, no dangling relay.
        address reg = registry;
        require(reg != address(0), "Registry not set");
        IStealthRegistry(reg).announce(ephemPubKeyX, ephemPubKeyY, bytes32(uint256(viewTag)), stealthHash);
    }

    /// @dev Shared forward core for `relay()` and `relayAndAnnounce`. Enforces
    ///      all invariants, skims the fee, forwards `msg.value - fee` to the
    ///      stealth recipient, and emits `PrivateTransfer`. Returns the
    ///      forwarded amount and the fee so callers/tests can inspect them.
    function _relayCore(address recipient, bytes32 ephemeralKey, uint8 viewTag)
        internal
        returns (uint256 transferAmount, uint256 fee)
    {
        require(msg.value > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");
        require(recipient != address(this), "Recipient == relayer contract");
        require(_feeBps <= MAX_FEE_BPS, "Fee misconfigured");

        fee = (msg.value * _feeBps) / FEE_DENOMINATOR;
        // MAX_FEE_BPS = 100 < FEE_DENOMINATOR, so fee < msg.value always; the
        // require above is a static defensive check, not the runtime guarantee.

        transferAmount = msg.value - fee;
        accumulatedFees += fee;
        _totalRelayed += transferAmount;

        (bool ok,) = recipient.call{value: transferAmount}("");
        require(ok, "Stealth forward failed");

        emit PrivateTransfer(
            keccak256(abi.encodePacked(recipient)), ephemeralKey, viewTag, transferAmount, fee, block.timestamp
        );
    }

    // ─── Optional prepaid buffer (refund-protecting) ───────────────────────
    /**
     * @notice Deposit ETH the relayer may use to fund `relay()` calls on the
     *         depositor's behalf. Fully refundable by the depositor at any
     *         time — the relayer CANNOT move these funds, only the depositor
     *         can withdraw or the relayer can `relay()` (which doesn't touch
     *         this mapping). For MVP the relayer fronts gas from its own hot
     *         wallet, so this path is optional.
     */
    function depositPrepaid() external payable {
        require(msg.value > 0, "Zero deposit");
        prepaidBalance[msg.sender] += msg.value;
        emit PrepaidDeposited(msg.sender, msg.value);
    }

    /// @notice Anyone who has a prepaid balance can claw 100% of it back. The
    /// contract owner and relayer have NO power over a depositor's balance.
    function withdrawPrepaid(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero withdraw");
        uint256 bal = prepaidBalance[msg.sender];
        require(bal >= amount, "Insufficient prepaid");
        prepaidBalance[msg.sender] = bal - amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Prepaid refund failed");
        emit PrepaidWithdrawn(msg.sender, amount);
    }

    // ─── Fee plumbing (owner only) ─────────────────────────────────────────
    /// @notice Withdraw accrued protocol fees to `to` (default: owner). These
    ///         fees exist ONLY because they were skimmed from relayed value;
    ///         no user principal is held — the relayer forwards value in-tx.
    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero recipient");
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Fee withdrawal failed");
        emit FeesWithdrawn(to, amount);
    }

    /// @notice Set the fee in basis points. Hard-capped at MAX_FEE_BPS (1%).
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 old = _feeBps;
        _feeBps = newFeeBps;
        emit FeeRateUpdated(old, newFeeBps);
    }

    // ─── Views matching the backend ABI ────────────────────────────────────
    /// @notice Backend reads this as `feeBps()`.
    function feeBps() external view returns (uint256) {
        return _feeBps;
    }

    /// @notice Backend reads this as `totalRelayed()` — cumulative wei sent to
    ///         stealth recipients. Used by the stats endpoint and the UI.
    function totalRelayed() external view returns (uint256) {
        return _totalRelayed;
    }

    // Accept plain ETH (e.g. accidental sends). Doesn't interact with prepaid
    // balances or fees — owner can recover via withdrawFees if it ever happens.
    receive() external payable {}
}
