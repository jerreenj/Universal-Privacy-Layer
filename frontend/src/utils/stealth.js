/**
 * Stealth Address Cryptography — EIP-5564 compatible
 * Uses @noble/secp256k1 v3 + ethers for proper EC operations on secp256k1
 *
 * Meta-address format: st:eth:0x<spend_pub_33bytes_hex><view_pub_33bytes_hex>
 */
import * as secp from "@noble/secp256k1";
import { ethers } from "ethers";

// ── Helpers ────────────────────────────────────────────────────────────────────
const toHex = (bytes) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

const keccak256 = (data) =>
  ethers.keccak256(data instanceof Uint8Array ? data : ethers.toUtf8Bytes(data));

/** secp256k1 curve order */
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

// ── Meta-Address Generation ────────────────────────────────────────────────────

/**
 * Generate a new stealth meta-address.
 * SAVE the private keys — they cannot be recovered.
 */
export function generateMetaAddress() {
  const spendPriv = secp.utils.randomSecretKey();
  const viewPriv  = secp.utils.randomSecretKey();
  const spendPub  = secp.getPublicKey(spendPriv, true); // compressed 33 bytes
  const viewPub   = secp.getPublicKey(viewPriv, true);

  const spendPrivHex = "0x" + toHex(spendPriv);
  const viewPrivHex  = "0x" + toHex(viewPriv);
  const spendPubHex  = "0x" + toHex(spendPub);
  const viewPubHex   = "0x" + toHex(viewPub);

  // st:eth:0x<spend_66hex><view_66hex>  (total 141 chars)
  const metaAddress = `st:eth:${spendPubHex}${toHex(viewPub)}`;

  return { spendPriv: spendPrivHex, viewPriv: viewPrivHex, spendPub: spendPubHex, viewPub: viewPubHex, metaAddress };
}

/**
 * Parse a stealth meta-address into spend/view public keys.
 */
export function parseMetaAddress(metaAddress) {
  const cleaned = metaAddress.replace("st:eth:", "").replace("0x", "");
  if (cleaned.length !== 132) throw new Error("Invalid meta-address length (expected 132 hex chars)");
  return {
    spendPub: "0x" + cleaned.slice(0, 66),
    viewPub:  "0x" + cleaned.slice(66),
  };
}

// ── Sender: Derive Stealth Address ────────────────────────────────────────────

/**
 * Given a recipient's meta-address, derive a unique one-time stealth address.
 * Run this on the SENDER side before transferring funds.
 */
export function deriveStealthAddress(metaAddress) {
  const { spendPub, viewPub } = parseMetaAddress(metaAddress);

  // 1. Random ephemeral keypair
  const ephPriv = secp.utils.randomSecretKey();
  const ephPub  = secp.getPublicKey(ephPriv, true);

  // 2. ECDH: shared = ephPriv * viewPub  (using secp256k1's built-in getSharedSecret)
  const viewPubBytes = secp.etc.hexToBytes(viewPub.replace("0x", ""));
  const shared = secp.getSharedSecret(ephPriv, viewPubBytes, true); // compressed

  // 3. h = keccak256(shared) mod N
  const h = BigInt(keccak256(shared)) % N;

  // 4. stealth_pub = spend_pub + h*G  (EC point addition)
  const spendPoint  = secp.Point.fromHex(spendPub.replace("0x", ""));
  const hG          = secp.Point.BASE.multiply(h);
  const stealthPoint = spendPoint.add(hG);

  // 5. stealth_address = keccak256(uncompressed_pub[1:])[last 20 bytes]
  const stealthUncompressed = stealthPoint.toBytes(false); // 65 bytes
  const stealthAddress = ethers.getAddress(
    "0x" + keccak256(stealthUncompressed.slice(1)).slice(-40)
  );

  // 6. view tag = first byte of h (fast scan filter)
  const viewTag = (h & 0xFFn).toString(16).padStart(2, "0");

  return {
    stealthAddress,
    ephemeralPub: "0x" + toHex(ephPub),
    viewTag,
  };
}

// ── Recipient: Scan Announcements ─────────────────────────────────────────────

/**
 * Scan announcements and return those belonging to this recipient.
 * Only needs the VIEW private key — spend key stays cold.
 */
export function scanAnnouncements(announcements, viewPrivHex, spendPubHex) {
  const viewPrivBytes = secp.etc.hexToBytes(viewPrivHex.replace("0x", ""));
  const spendPoint    = secp.Point.fromHex(spendPubHex.replace("0x", ""));
  const matched = [];

  for (const ann of announcements) {
    try {
      const ephBytes = secp.etc.hexToBytes(ann.ephemeral_pub.replace("0x", ""));

      // ECDH: shared = viewPriv * ephPub
      const shared = secp.getSharedSecret(viewPrivBytes, ephBytes, true);
      const h      = BigInt(keccak256(shared)) % N;

      // Quick view-tag filter (avoids heavy EC ops on non-matches)
      const myTag = (h & 0xFFn).toString(16).padStart(2, "0");
      if (myTag !== ann.view_tag) continue;

      // Derive stealth address
      const hG           = secp.Point.BASE.multiply(h);
      const stealthPoint = spendPoint.add(hG);
      const stealthUncompressed = stealthPoint.toBytes(false);
      const derivedStealth = ethers.getAddress(
        "0x" + keccak256(stealthUncompressed.slice(1)).slice(-40)
      );

      // Confirm exact match
      if (derivedStealth.toLowerCase() === ann.stealth_address?.toLowerCase()) {
        matched.push({ ...ann, derivedStealth });
      }
    } catch { /* malformed — skip */ }
  }

  return matched;
}

// ── Recipient: Compute Stealth Private Key (sweep) ────────────────────────────

/**
 * Compute stealth private key so recipient can sign a sweep transaction.
 * stealth_priv = (spend_priv + h) mod N
 */
export function computeStealthPrivKey(spendPrivHex, viewPrivHex, ephemeralPubHex) {
  const viewPrivBytes = secp.etc.hexToBytes(viewPrivHex.replace("0x", ""));
  const ephBytes      = secp.etc.hexToBytes(ephemeralPubHex.replace("0x", ""));
  const spendPrivBig  = BigInt("0x" + spendPrivHex.replace("0x", ""));

  const shared = secp.getSharedSecret(viewPrivBytes, ephBytes, true);
  const h      = BigInt(keccak256(shared)) % N;

  const stealthPriv = (spendPrivBig + h) % N;
  return "0x" + stealthPriv.toString(16).padStart(64, "0");
}
