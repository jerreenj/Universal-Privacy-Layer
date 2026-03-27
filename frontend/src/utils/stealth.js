/**
 * Stealth Address Cryptography — EIP-5564 compatible
 * Uses @noble/secp256k1 for proper EC point operations on secp256k1
 *
 * Meta-address format: st:eth:0x<spend_pub_33bytes><view_pub_33bytes>
 */
import * as secp from "@noble/secp256k1";
import { ethers } from "ethers";

// ── Helpers ────────────────────────────────────────────────────────────────────
const toBigInt = (hex) => BigInt("0x" + hex.replace("0x", ""));
const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

/** Hash bytes → 32-byte Uint8Array */
async function sha256(data) {
  const buf = await crypto.subtle.digest("SHA-256", data instanceof Uint8Array ? data : new TextEncoder().encode(data));
  return new Uint8Array(buf);
}

/** keccak256 via ethers */
const keccak256 = (data) => ethers.keccak256(data instanceof Uint8Array ? data : ethers.toUtf8Bytes(data));

/** secp256k1 curve order n */
const CURVE_N = secp.etc.bytesToNumberBE(secp.utils.randomPrivateKey()) > 0n
  ? 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  : 0n;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

// ── Meta-Address Generation ────────────────────────────────────────────────────

/**
 * Generate a new stealth meta-address.
 * Returns spend keypair, view keypair, and combined meta-address string.
 * SAVE the private keys securely — they cannot be recovered.
 */
export function generateMetaAddress() {
  const spendPriv = secp.utils.randomPrivateKey();
  const viewPriv  = secp.utils.randomPrivateKey();

  const spendPub = secp.getPublicKey(spendPriv, true); // compressed 33 bytes
  const viewPub  = secp.getPublicKey(viewPriv, true);

  const spendPrivHex = "0x" + toHex(spendPriv);
  const viewPrivHex  = "0x" + toHex(viewPriv);
  const spendPubHex  = "0x" + toHex(spendPub);
  const viewPubHex   = "0x" + toHex(viewPub);

  // meta-address = st:eth:0x<spend_33bytes><view_33bytes> (132 hex chars after 0x)
  const metaAddress = `st:eth:${spendPubHex}${toHex(viewPub)}`;

  return {
    spendPriv: spendPrivHex,
    viewPriv:  viewPrivHex,
    spendPub:  spendPubHex,
    viewPub:   viewPubHex,
    metaAddress,
  };
}

/**
 * Parse a stealth meta-address string into spend/view public keys.
 */
export function parseMetaAddress(metaAddress) {
  const cleaned = metaAddress.replace("st:eth:", "").replace("0x", "");
  if (cleaned.length !== 132) throw new Error("Invalid meta-address length");
  const spendPub = "0x" + cleaned.slice(0, 66);
  const viewPub  = "0x" + cleaned.slice(66);
  return { spendPub, viewPub };
}

// ── Sender: Derive Stealth Address ────────────────────────────────────────────

/**
 * Given a recipient's meta-address, derive a unique stealth address.
 * This is what the SENDER runs before transferring funds.
 *
 * @returns { stealthAddress, ephemeralPub, viewTag }
 */
export function deriveStealthAddress(metaAddress) {
  const { spendPub, viewPub } = parseMetaAddress(metaAddress);

  // 1. Random ephemeral keypair
  const ephPriv = secp.utils.randomPrivateKey();
  const ephPub  = secp.getPublicKey(ephPriv, true); // compressed

  // 2. ECDH: shared = ephPriv * viewPub
  const viewPubBytes = secp.Point.fromHex(viewPub.replace("0x", ""));
  const shared = viewPubBytes.multiply(secp.etc.bytesToNumberBE(ephPriv));
  const sharedBytes = shared.toRawBytes(true); // compressed

  // 3. h = keccak256(sharedBytes)
  const h = toBigInt(keccak256(sharedBytes).replace("0x", ""));

  // 4. stealth_pub = spend_pub + h*G (point addition)
  const spendPoint = secp.Point.fromHex(spendPub.replace("0x", ""));
  const hG = secp.Point.BASE.multiply(h);
  const stealthPoint = spendPoint.add(hG);

  // 5. stealth address = keccak256(stealthPoint uncompressed[1:])[12:]
  const stealthPubUncompressed = stealthPoint.toRawBytes(false).slice(1); // 64 bytes, no prefix
  const stealthAddress = "0x" + keccak256(stealthPubUncompressed).slice(-40);

  // 6. view tag = first byte of h (as hex)
  const viewTag = (h & 0xFFn).toString(16).padStart(2, "0");

  return {
    stealthAddress: ethers.getAddress(stealthAddress),
    ephemeralPub: "0x" + toHex(ephPub),
    viewTag,
  };
}

// ── Recipient: Scan Announcements ─────────────────────────────────────────────

/**
 * Scan a list of announcements and return ones that belong to this recipient.
 * Uses view key (read-only) — spend key is NOT needed for scanning.
 *
 * @param announcements  Array from GET /api/stealth/announcements
 * @param viewPrivHex    Recipient's view private key
 * @param spendPubHex    Recipient's spend public key (for address derivation)
 * @returns Array of matched announcements with derived stealth address
 */
export function scanAnnouncements(announcements, viewPrivHex, spendPubHex) {
  const viewPrivBytes = secp.etc.hexToBytes(viewPrivHex.replace("0x", ""));
  const spendPoint = secp.Point.fromHex(spendPubHex.replace("0x", ""));
  const matched = [];

  for (const ann of announcements) {
    try {
      const ephPoint = secp.Point.fromHex(ann.ephemeral_pub.replace("0x", ""));

      // 1. ECDH: shared = viewPriv * ephPub
      const shared = ephPoint.multiply(secp.etc.bytesToNumberBE(viewPrivBytes));
      const sharedBytes = shared.toRawBytes(true);

      // 2. h = keccak256(sharedBytes)
      const h = toBigInt(keccak256(sharedBytes).replace("0x", ""));

      // 3. Quick filter: check view tag (first byte of h)
      const myViewTag = (h & 0xFFn).toString(16).padStart(2, "0");
      if (myViewTag !== ann.view_tag) continue; // fast skip

      // 4. Derive stealth address
      const hG = secp.Point.BASE.multiply(h);
      const stealthPoint = spendPoint.add(hG);
      const stealthPubUncompressed = stealthPoint.toRawBytes(false).slice(1);
      const stealthAddress = ethers.getAddress(
        "0x" + keccak256(stealthPubUncompressed).slice(-40)
      );

      // 5. Confirm match (stealth address must match announcement)
      if (stealthAddress.toLowerCase() === ann.stealth_address.toLowerCase()) {
        matched.push({ ...ann, derivedStealth: stealthAddress });
      }
    } catch {
      // malformed announcement — skip
    }
  }

  return matched;
}

// ── Recipient: Compute Stealth Private Key (for sweeping) ─────────────────────

/**
 * Compute the stealth private key so the recipient can sign a sweep tx.
 * stealth_priv = (spend_priv + h) mod N
 *
 * @returns hex private key of the stealth address
 */
export function computeStealthPrivKey(spendPrivHex, viewPrivHex, ephemeralPubHex) {
  const viewPrivBytes = secp.etc.hexToBytes(viewPrivHex.replace("0x", ""));
  const spendPrivBig  = toBigInt(spendPrivHex.replace("0x", ""));

  const ephPoint  = secp.Point.fromHex(ephemeralPubHex.replace("0x", ""));
  const shared    = ephPoint.multiply(secp.etc.bytesToNumberBE(viewPrivBytes));
  const sharedBytes = shared.toRawBytes(true);

  const h = toBigInt(keccak256(sharedBytes).replace("0x", ""));
  const stealthPriv = (spendPrivBig + h) % N;

  return "0x" + stealthPriv.toString(16).padStart(64, "0");
}
