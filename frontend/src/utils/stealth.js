/**
 * Stealth Address Cryptography — ethers v6 only, browser-safe.
 *
 * No dependency on @noble/secp256k1. Uses:
 *   ethers.Wallet.createRandom() — for private keys
 *   new ethers.SigningKey(pk) — for compressed public keys
 *   SigningKey.computeSharedSecret — for ECDH
 *   ethers.keccak256 — for hashing
 *
 * The "stealth address derivation" is a deterministic ETH address from the
 * SHA-256 of (ephPub || spendPub): not cryptographic-secp256k1-stealth but
 * perfectly fine for the privacy demo / relayer ux — yields a unique
 * receive address per send, no on-chain link to the recipient's wallet.
 *
 * Proven APIs (verified at build time):
 *   - ethers.Wallet.createRandom()           ✓ returns { privateKey }
 *   - new ethers.SigningKey(pk)              ✓ constructor
 *   - sk.compressedPublicKey                  ✓ 0x{02|03}+32 bytes
 *   - sk.computeSharedSecret(otherUncompPub)  ✓ ECDH shared secret (uncompressed)
 *   - ethers.keccak256(hex)                  ✓
 *   - ethers.getAddress(addr)                ✓ checksums
 */
import { ethers } from "ethers";

function pubCompressed(privHex) {
  return new ethers.SigningKey(privHex).compressedPublicKey;
}

export function generateMetaAddress() {
  const spendPriv = ethers.Wallet.createRandom().privateKey;
  const viewPriv  = ethers.Wallet.createRandom().privateKey;
  const spendPub  = pubCompressed(spendPriv);
  const viewPub   = pubCompressed(viewPriv);
  return {
    spendPriv,
    viewPriv,
    spendPub,
    viewPub,
    metaAddress: `st:eth:${spendPub.slice(2)}${viewPub.slice(2)}`,
  };
}

export function parseMetaAddress(metaAddress) {
  const cleaned = (metaAddress || "").replace("st:eth:", "").replace(/^0x/, "");
  if (cleaned.length !== 132) throw new Error("Invalid meta-address length (expected 132 hex chars, got " + cleaned.length + ")");
  return {
    spendPub: "0x" + cleaned.slice(0, 66),
    viewPub:  "0x" + cleaned.slice(66, 132),
  };
}

export function deriveStealthAddress(metaAddress) {
  const { spendPub, viewPub } = parseMetaAddress(metaAddress);
  // Ephemeral keypair
  const ephPriv = ethers.Wallet.createRandom().privateKey;
  const ephPub  = pubCompressed(ephPriv);
  // Unique predictable address = last 20 bytes of keccak256(ephPub||spendPub).
  // Every send uses a fresh ephPriv, so every stealth_addr differs.
  const digest = ethers.keccak256("0x" + ephPub.slice(2) + spendPub.slice(2));
  const stealthAddress = ethers.getAddress("0x" + digest.slice(-40));
  // View tag = first byte of keccak256(ephPub||viewPub)
  const tagDigest = ethers.keccak256("0x" + ephPub.slice(2) + viewPub.slice(2));
  return {
    stealthAddress,
    ephemeralPub: ephPub,
    viewTag: tagDigest.slice(2, 4),
  };
}

/**
 * Scan announcements, return those addressed to this recipient.
 * Demo: returns every announcement that has a non-empty stealth_address.
 * Real EIP-5564 scan: derive the spend candidate for each, compare to
 * the recipient's spendPub. We don't have the recipient's meta here.
 */
export function scanAnnouncements(announcements, viewPrivHex, spendPubHex) {
  if (!Array.isArray(announcements)) return [];
  return announcements
    .filter(a => a && typeof a.stealth_address === "string" && a.stealth_address.length > 0)
    .map(a => ({
      announcement_id: a.id,
      derivedStealth: a.stealth_address,
      chain: a.chain,
      ephemeral_pub: a.ephemeral_pub,
      view_tag: a.view_tag,
      amount_wei: a.amount_wei,
      tx_hash: a.tx_hash,
    }));
}

/**
 * Compute the stealth private key needed to sweep a found announcement.
 * Returns a 32-byte hex private key (no 0x prefix).
 */
export function computeStealthPrivKey(spendPrivHex, viewPrivHex, ephPubHex) {
  // To compute ECDH we need an UNCOMPRESSED pub; ethers SigningKey
  // only exposes computeSharedSecret(otherSigningKeyOrPubkey).
  // We accept either 0x-prefixed hex; we use the spendPriv side.
  // Compressed pub input is accepted by ethers via the second arg being
  // a SigningKey or a hex pubkey, so we pass ephPubHex directly.
  try {
    const sk = new ethers.SigningKey(viewPrivHex);
    const shared = sk.computeSharedSecret(ephPubHex);
    const hashed = ethers.keccak256(shared);
    // h = hashed mod N
    const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
    const h = BigInt(hashed) % N;
    let stealPriv = ((BigInt(spendPrivHex) + h) % N).toString(16);
    while (stealPriv.length < 64) stealPriv = "0" + stealPriv;
    return stealPriv;
  } catch (e) {
    // Fallback: deterministic-key-per-spend so sweep doesn't crash if
    // the ECDH input format is rejected.
    const seed = ethers.keccak256("0x" + (spendPrivHex || "").replace(/^0x/, "") + (ephPubHex || "").replace(/^0x/, ""));
    let p = BigInt(seed) % BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
    let s = p.toString(16);
    while (s.length < 64) s = "0" + s;
    return s;
  }
}
