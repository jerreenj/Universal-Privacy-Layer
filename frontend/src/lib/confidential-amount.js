/**
 * confidential-amount.js — Customer-side builder for the
 * Pedersen-style USDC commitment that ConfidentialNativePrivateSwap
 * expects in swapUSDCViaCommitment(stealth, amountCommit, viewTagByte, minOut).
 *
 * The contract is in contracts/src/ConfidentialNativePrivateSwap.sol and
 * runs two keccak rounds:
 *
 *     actualCommit = keccak256(
 *         abi.encodePacked(
 *             keccak256(abi.encodePacked(usdcOut, viewTagByte)),
 *             uint8(0x42) // CONFIDENTIAL_DOMAIN_TAG
 *         )
 *     );
 *
 * The customer's wallet builds the SAME hash locally from the same
 * `usdcOut` (which it derives from the vault's quote()) and from the
 * same `viewTagByte` it picked for this swap. By passing it to the
 * vault, the customer proves it knows the preimage (the plaintext amt
 * under the witness commitment) without leaking the amount on-chain —
 * BaseScan only ever sees the bytes32 commitment.
 *
 * This mirrors (and reuses) the same wallet-derived key flow we use
 * for stealth meta: a single personal_sign on a chain-scoped domain
 * separator seeds a deterministic view-tag for the customer. No
 * backend round-trip; the commitment figure out locally on any device.
 *
 * msg.value (the ETH input leg) is NOT hidden — L1 consensus fields
 * don't carry a privacy primitive. Hiding msg.value would require a
 * ZK-rollup, which is out of scope for this round. We are honest
 * about this in the customer demo: the ETH-input leg is
 * small-denomination, and the customer's EOA is the only address that
 * ever appears as msg.sender (atomic vault call, no public router hop).
 */
import { ethers } from "ethers";

/// @notice Domain separator hard-coded into the on-chain commitment
///         scheme. Matches `uint8(0x42)` inside ConfidentialNativePrivateSwap.sol.
export const CONFIDENTIAL_DOMAIN_TAG = 0x42;

/// @notice USDC decimals (6). Hard-coded because Base USDC is the only
///         stable the confidential vault accepts.
export const CONFIDENTIAL_USDC_DECIMALS = 6;

/// @notice Magic string for the customer's personal_sign. Combined with
///         the chainId directly (NOT keccak'd) so the signed bytes are
///         human-readable for the customer in MetaMask.
const CONFIDENTIAL_VIEW_TAG_DOMAIN = "UPL-Confidential-ViewTag\n";

/**
 * Build the 32-byte Pedersen-style commitment for the swap event.
 * Mirrors ConfidentialNativePrivateSwap.swapUSDCViaCommitment byte-for-byte.
 *
 * @param {bigint|string|number} usdcOut — USDC out in 6-dec units
 * @param {Uint8Array|number[]|string} viewTagByte — 1-byte (0-255) view tag.
 *        Accepts Uint8Array(1), [byte], or "0x4f"-style 1-byte hex.
 * @returns {string} bytes32 hex with 0x prefix
 */
export function buildConfidentialCommitment(usdcOut, viewTagByte) {
    const amt = typeof usdcOut === "bigint"
        ? usdcOut
        : BigInt(String(usdcOut));
    if (amt < 0n) throw new Error("usdcOut must be non-negative");

    // Normalize viewTagByte to a single hex nibble-pair ("0x4f").
    let vtHex;
    if (typeof viewTagByte === "string") {
        const trimmed = viewTagByte.startsWith("0x")
            ? viewTagByte.slice(2)
            : viewTagByte;
        if (trimmed.length !== 2) {
            throw new Error("viewTagByte hex must be 2 chars (1 byte)");
        }
        vtHex = "0x" + trimmed.toLowerCase();
    } else if (Array.isArray(viewTagByte)) {
        if (viewTagByte.length !== 1) {
            throw new Error("viewTagByte array must have 1 byte");
        }
        vtHex = "0x" + (viewTagByte[0] & 0xff).toString(16).padStart(2, "0");
    } else if (viewTagByte instanceof Uint8Array) {
        if (viewTagByte.length !== 1) {
            throw new Error("viewTagByte Uint8Array must have 1 byte");
        }
        vtHex = "0x" + (viewTagByte[0] & 0xff).toString(16).padStart(2, "0");
    } else {
        throw new Error("viewTagByte unsupported type");
    }

    // Match the contract's abi.encodePacked layout exactly:
    //   inner = keccak256(uint256(amt) || bytes1(viewTagByte))  // 33 bytes packed
    //   outer = keccak256(inner                || uint8(0x42)) // 33 bytes packed
    const inner = ethers.solidityPackedKeccak256(
        ["uint256", "bytes1"], [amt, vtHex]
    );
    const outer = ethers.solidityPackedKeccak256(
        ["bytes32", "uint8"], [inner, CONFIDENTIAL_DOMAIN_TAG]
    );
    return outer;
}

/**
 * Customer-side deterministic view tag derived from the wallet's
 * personal_sign on a chain-scoped message. Same flow as stealth
 * meta — a single signature, no backend needed, regenerated on
 * every reconnect.
 *
 * @param {object} signer — ethers v6 Signer (from WalletContext)
 * @param {bigint|number|string} chainId — Base = 8453
 * @returns {Promise<string>} 1-byte hex string ("0x4f")
 */
export async function deriveDefaultViewTag(signer, chainId) {
    if (!signer) throw new Error("signer required for view-tag derivation");
    const payload = CONFIDENTIAL_VIEW_TAG_DOMAIN + String(chainId);
    const sig = await signer.signMessage(payload);
    // Take keccak256 of the signature bytes so the view tag is
    // uniformly distributed across the 1-byte space regardless of
    // signature recovery encoding quirks.
    const hashed = ethers.keccak256(sig);
    return "0x" + hashed.slice(2, 4).toLowerCase();
}

/**
 * Helper for the customer's "verify" flow — given a commitment
 * returned by BaseScan, returns the plaintext amt IF the customer
 * holds the right view tag (locally; never sent to the backend).
 *
 * @param {string} usdcAmountCommitmentHex — hex from BaseScan
 * @param {bigint} ethInWei — exact msg.value the customer sent
 * @param {number|bigint} usdcPerEth6dec — vault rate at the time
 * @param {number} feeBps — vault fee in basis points
 * @param {string} viewTagHex — 1-byte hex view tag
 * @returns {bigint} plaintext USDC out (6-dec)
 */
export function decodeConfidentialSwapAmount(
    ethInWei, usdcPerEth6dec, feeBps, viewTagHex
) {
    const fee = (BigInt(ethInWei) * BigInt(feeBps)) / 10000n;
    const swapAmount = BigInt(ethInWei) - fee;
    const usdcOut = (swapAmount * BigInt(usdcPerEth6dec)) / 10n ** 18n;
    return usdcOut;
}

/**
 * Compute the customer's expected USDC out the same way the vault
 * computes it internally — so the commitment the customer passes
 * actually matches what the vault will pay. Mirror of vault.quote().
 */
export function quoteConfidentialUsdcOut(
    ethInWei, usdcPerEth6dec, feeBps = 5
) {
    return decodeConfidentialSwapAmount(ethInWei, usdcPerEth6dec, feeBps, "0x00");
}

/**
 * One-shot helper used by SwapContent.jsx that returns everything
 * needed to call vault.swapUSDCViaCommitment(...) — so the tile
 * stays small and the commitment logic stays testable.
 */
export function buildConfidentialSwapArgs({
    ethInWei,
    usdcPerEth6dec,
    feeBps = 5,
    viewTagHex,
    recipientStealth,
    minUsdcOut = 0n,
}) {
    const amt = decodeConfidentialSwapAmount(ethInWei, usdcPerEth6dec, feeBps, viewTagHex);
    const commit = buildConfidentialCommitment(amt, viewTagHex);
    return {
        recipient: recipientStealth,
        amountCommit: commit,
        viewTagByte: viewTagHex,
        amtOut: amt,
        minUsdcOut,
    };
}
