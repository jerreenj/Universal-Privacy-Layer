/**
 * crypto-seal.js — E2E encryption helpers for privacy-critical metadata.
 *
 * Motivation: the customer pilot's on-chain privacy (EIP-5564 stealth +
 * PrivacyPool ZK + AerodromePrivacyWrapper shared mixer) is real. But
 * several backend endpoints (stealth generate/store, history/record) used
 * to store plaintext metadata keyed by the user's EOA so the server could
 * correlate the customer's EOA with their stealth activities.
 *
 * This module closes that side-channel. It derives an AES-256-GCM key
 * from a wallet-issued signature on a fixed domain, then seals arbitrary
 * metadata to `{ciphertext, iv, salt, addr}` envelopes before any POST.
 * The server stores ciphertext only; the user decrypts locally on read.
 *
 * Threat model + properties:
 *   - Server NEVER has the wallet's private key, so it cannot derive the
 *     seal key. Thus it cannot read any sealed record.
 *   - The seal key is deterministic per EOA + domain separator (HKDF
 *     over a personal_sign(...) signature). Same EOA across sessions
 *     reproduces the same key so `record()` then `history()` round-trips.
 *   - Different EOA → different key. Server sees the EOA but cannot
 *     read the contents.
 *   - The cache is per-wallet-session + per-EOA; persistent storage is
 *     left to the user's wallet seed (the keys are deterministic, so
 *     the cache can rebuild after a refresh from a single signature).
 *   - Web Crypto SubtleCrypto is used (window.crypto.subtle); pure
 *     browser-side, no extra deps. polyfills left to the host app.
 *   - No key material ever leaves the browser. server only sees public
 *     metadata (EOA, ciphertext blob, iv, salt, addr).
 *
 * Wire format (envelope):
 *   {
 *     ciphertext: "<base64>",  // AES-GCM output (12-byte IV prepended per WebCrypto)
 *     iv:         "<base64>",  // 12 bytes — random per record
 *     salt:       "<base64>",  // 16 bytes — HKDF salt (random per record; binds ciphertext to key derivation)
 *     addr:       "0x…",       // EOA that derived the seal key (used by server only for indexing)
 *   }
 */

const DOMAIN_SEPARATOR =
  "Universal Privacy Layer end-to-end encryption root · v1 · " +
  "do not reuse this string elsewhere; signing it grants access to your " +
  "encrypted metadata.";

const _sealKeyCache = new Map(); // addr -> CryptoKey

// ─── helpers ───────────────────────────────────────────────────────────
function fromHex(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    throw new Error("expected 0x-prefixed hex");
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

// Base64 <-> Uint8Array (browser-friendly).
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Encode an arbitrary (string|object) payload into JSON-bytes.
function encodePayload(payload) {
  return new TextEncoder().encode(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
}

function decodePayload(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ─── key derivation ─────────────────────────────────────────────────────
// Sign the DOMAIN_SEPARATOR with the user's wallet to produce 65 bytes
// of recoverable signature. Treat the signature as the raw secret
// material; HKDF derives the AES-256-GCM key from it + per-record salt.
//
// We DO NOT cache the signature; we cache only the derived CryptoKey.
// Cached by EOA so the user signs once per session, not per record.
//
// `wallet` should be an ethers v6 Signer (signer.signMessage works).
export async function deriveSealKey(wallet, addr) {
  if (!wallet || !addr) throw new Error("wallet + addr required");
  const cached = _sealKeyCache.get(addr);
  if (cached) return cached;

  // personal_sign over the fixed domain. The signature is 65 bytes
  // (r||s||v). We HKDF those bytes -> 32-byte AES-256-GCM key.
  const signatureHex = await wallet.signMessage(DOMAIN_SEPARATOR);
  const sigBytes = fromHex(signatureHex);

  // HKDF-Extract: PRK = HMAC-SHA256(salt=0x00..00, IKM=signature)
  const saltZeroKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const prk = await crypto.subtle.sign(
    "HMAC",
    saltZeroKey,
    sigBytes,
  );

  // HKDF-Expand: OKM = HMAC-SHA256(PRK, "" || 0x01) for a single 32-byte block.
  const expandKey = await crypto.subtle.importKey(
    "raw",
    prk,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const info = new TextEncoder().encode("upl-seal-aes-256-gcm-v1");
  const okmInput = new Uint8Array(info.length + 1);
  okmInput.set(info, 0);
  okmInput[info.length] = 0x01;
  const okm = await crypto.subtle.sign("HMAC", expandKey, okmInput);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    okm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  _sealKeyCache.set(addr.toLowerCase(), aesKey);
  return aesKey;
}

// ─── public API ─────────────────────────────────────────────────────────
//
// seal(plaintext, wallet, addr) -> { ciphertext, iv, salt, addr }
//
// Plaintext can be any JSON-serializable value. The returned envelope is
// safe to POST to the backend — the server stores it without ever being
// able to read the inner JSON.

export async function seal(plaintext, wallet, addr) {
  if (!wallet || !addr) throw new Error("seal: wallet + addr required");
  const key = await deriveSealKey(wallet, addr);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const plaintextBytes = encodePayload(plaintext);

  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: salt },
    key,
    plaintextBytes,
  );

  return {
    ciphertext: bytesToB64(new Uint8Array(ct)),
    iv:         bytesToB64(iv),
    salt:       bytesToB64(salt),
    addr:       addr,
  };
}

// unseal(envelope, wallet) -> the original plaintext object.
//
// Wallet is required because we re-derive the per-EOA seal key. The
// envelope's `addr` field is cross-checked as well so an attacker
// cannot replay one EOA's envelope under another EOA's session.

export async function unseal(envelope, wallet) {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("unseal: envelope must be an object");
  }
  const addr = (envelope.addr || "").toLowerCase();
  if (!addr) throw new Error("unseal: envelope.addr missing");
  if (!wallet) throw new Error("unseal: wallet required for key derivation");
  const expected = (await wallet.getAddress()).toLowerCase();
  if (expected !== addr) {
    throw new Error("unseal: envelope.addr does not match connected wallet");
  }
  const key = await deriveSealKey(wallet, addr);

  const ct     = b64ToBytes(envelope.ciphertext);
  const iv     = b64ToBytes(envelope.iv);
  const salt   = b64ToBytes(envelope.salt);

  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: salt },
    key,
    ct,
  );

  return decodePayload(pt);
}

// unsealMany(envelopes, wallet) -> array of plaintext objects, skipping
// envelopes that fail to decrypt (e.g., dropped when the user switched
// EOA between record + history). Per-row isolation means one failed
// decrypt cannot abort the whole history render.

export async function unsealMany(envelopes, wallet) {
  if (!Array.isArray(envelopes)) return [];
  const out = [];
  for (const env of envelopes) {
    try {
      out.push(await unseal(env, wallet));
    } catch (e) {
      // Skip the unreadable row. The history tile surfaces this as a
      // "(locked)" placeholder rather than crashing.
      out.push({ __sealFailed: true, addr: env?.addr ?? null });
    }
  }
  return out;
}

// Invalidate the cache for an EOA — used when the user switches wallet
// or signs out. Refreshes from a fresh signMessage() the next time the
// page needs to seal or unseal.

export function clearSealCache(addr) {
  if (addr) _sealKeyCache.delete(addr.toLowerCase());
  else _sealKeyCache.clear();
}
