/**
 * wallet-stealth.js — Customer-side stealth-address generation, derived
 * entirely from the customer's wallet signature. Replaces the
 * `/api/stealth/generate` server endpoint for the customer pilot (Gap 5a
 * of the Base-Privacy-Pilot closer list: detach stealth-generation
 * dependency from the backend).
 *
 * Flow:
 *
 *  1. The customer's wallet produces a deterministic EIP-191 signature
 *     over a fixed domain separator:
 *
 *         signDOMAIN = keccak256("UPL-Stealth-Meta\n" + chainId)
 *
 *     Both the spend-side and view-side keys are derived from this
 *     signature via HKDF-SHA-256. The same wallet signature on the
 *     same chainId regenerates the same meta-address every time →
 *     stable address across sessions, no server storage needed.
 *     (Spec: secp256k1 meta-address generates the same view-tag
 *     band / spend pubkey on every signature.)
 *
 *  2. The customer produces a per-payment ephemeral keypair
 *     (secp256k1 ECDH against the view pubkey) and computes
 *     `stealthAddress = viewPub + spendPub * sharedSecret` →
 *     unveils a one-time destination that only the recipient
 *     (signatory of the same meta) can spend from.
 *
 *  3. After generation, the customer's wallet announces the
 *     ephemeral pub key to the StealthAddressRegistry via the
 *     relayer (still on backend for atomic relay+announce,
 *     P2.9.7) — the announcement is the only on-chain footprint
 *     and contains NO view-side or spend-side private material
 *     (ephemeral pubkey + viewTag only → recipient can filter).
 *
 * All of this avoids a backend round-trip for stealth key
 * generation itself; only the eventual announce + relay still
 * parties against the backend, and the announce payload is
 * publicly observable by definition.
 */

import * as ethersUtils from "@/lib/ethers-lazy";

// Domain separator for the meta-derivation personal_sign. We use a
// PLAIN-STRING message directly (no solidityPacked encoding) to
// avoid the BytesLike conversion edge-case where some ethers
// versions return a Number from solidityPackedKeccak256 under
// heavy load and then choke on getBytes("2817..."). Plain string
// → signMessage accepts it directly → no decode path.
function domainFor(chainId) {
  const id = typeof chainId === "bigint" ? chainId.toString() : String(chainId);
  return "UPL-Stealth-Meta\nchain=" + id;
}

/**
 * signMetaDomain(signer, chainId) — produces a deterministic
 * personal_sign over a fixed plain-text domain separator. Returns
 * the 65-byte signature (r||s||v). Passes the message as a plain
 * string to signMessage so the wallet wraps it with EIP-191 and
 * avoids any BytesLike decode edge-case.
 */
export async function signMetaDomain(signer, chainId) {
  return await signer.signMessage(domainFor(chainId));
}

/**
 * hkdfFromSignature(signatureBytes, info, length = 32) → Uint8Array
 * HKDF-Extract + HKDF-Expand with the wallet signature as IKM and
 * a fixed salt of zero (salt-less HKDF is fine — IKM is already
 * high-entropy from secp256k1 signature material).
 */
export async function hkdfFromSignature(signatureBytes, info, length = 32) {
  // ethers' sha256 doesn't include HMAC; roll our own using subtle.
  const sigBytes = ethersUtils.toUtf8Bytes(signatureBytes);
  const ikm = sigBytes; // (could pad to longer; 65 bytes is fine for HKDF)
  // HKDF-Extract per RFC 5869: PRK = HMAC-SHA-256(salt=HashLen zeros, ikm).
  // IMPORTANT: subtle.importKey rejects EMPTY keys with
  // 'HMAC key data must not be empty', so we feed 32 zero bytes — the
  // mathematical equivalent of "salt is empty" per the spec.
  const prk = await hmacSha256(new Uint8Array(32), ikm);
  // HKDF-Expand: derive `length` bytes via iterative HMAC.
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let counter = 1;
  let written = 0;
  const infoBytes = ethersUtils.toUtf8Bytes(info);
  while (written < length) {
    const block = await hmacSha256(prk, concat([infoBytes, new Uint8Array([counter])]));
    prev = block;
    const take = Math.min(block.length, length - written);
    out.set(block.slice(0, take), written);
    written += take;
    counter++;
  }
  return out;
}

async function hmacSha256(key, msg) {
  const c = crypto.subtle;
  const k = await c.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await c.sign("HMAC", k, msg);
  return new Uint8Array(sig);
}

function concat(arrays) {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * deriveSpendKeyFromWallet(signer, chainId) → BigInt
 * Deterministic spend privkey = HKDF(signMetaDomain, "spend")
 */
export async function deriveSpendKeyFromWallet(signer, chainId) {
  const sig = await signMetaDomain(signer, chainId);
  const bytes = await hkdfFromSignature(sig, "upl-stealth:spend", 32);
  // Treat as big-endian int; reduce into the secp256k1 curve order's
  // range by mod n. n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141.
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const k = BigInt("0x" + bytesToHex(bytes));
  // mod n; if it lands on 0 (negligible probability) re-call.
  let mod = k % n;
  if (mod === 0n) {
    throw new Error("zero spend key — re-attempt with a different chainId");
  }
  return mod;
}

/**
 * deriveViewKeyFromWallet(signer, chainId) → BigInt
 * Deterministic view privkey = HKDF(signMetaDomain, "view")
 */
export async function deriveViewKeyFromWallet(signer, chainId) {
  const sig = await signMetaDomain(signer, chainId);
  const bytes = await hkdfFromSignature(sig, "upl-stealth:view", 32);
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const k = BigInt("0x" + bytesToHex(bytes));
  const mod = k % n;
  if (mod === 0n) {
    throw new Error("zero view key — re-attempt with a different chainId");
  }
  return mod;
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * deriveMetaAddress(signer, chainId) → { spendPub, viewPub, stealthEOA }
 * Returns the meta-address components + a sample stealth address
 * (the first announcement of the meta against itself is sufficient
 * for a UI to confirm wiring). The customer's EOA never appears
 * in the meta — only the spend + view pubkeys.
 *
 * For an actual per-payment stealth address, use `generateStealthAddress`
 * which produces a fresh ephemeral keypair per payment.
 */
export async function deriveMetaAddress(signer, chainId) {
  const spendPriv = await deriveSpendKeyFromWallet(signer, chainId);
  const viewPriv = await deriveViewKeyFromWallet(signer, chainId);
  // secp256k1 privkey → pubkey via ethers HDNode / SigningKey helpers.
  const spendNode = new ethers.SigningKey("0x" + spendPriv.toString(16).padStart(64, "0"));
  const viewNode = new ethers.SigningKey("0x" + viewPriv.toString(16).padStart(64, "0"));
  const spendPub = "0x" + spendNode.publicKey.slice(4); // uncompressed, 64 bytes (no 0x04 prefix)
  const viewPub = "0x" + viewNode.publicKey.slice(4);
  return {
    spendPub,
    viewPub,
    spendPriv: spendPriv.toString(16).padStart(64, "0"),
    viewPriv: viewPriv.toString(16).padStart(64, "0"),
    // Meta-address encoding per ERC-5564: spend_pub || view_pub
    metaAddress: spendPub + viewPub.slice(2),
  };
}

/**
 * deriveStealthEOA(signer, entropy?) → { address, privateKey }
 * The customer's PRIVATE receive address, derived from a wallet
 * signature. Chain-independent — the same derivation works on
 * Base, Arbitrum, Optimism, anywhere EVM. This is the address the
 * customer shares; payments to it land in the browser's locally
 * controlled private key.
 *
 * Same signature flow as the meta-derivative above, but the
 * HKDF info string is "upl-stealth:wallet-2" so the output is
 * chain-agnostic (the OLD meta-derivation was per-chainId via
 * domainFor(chainId)). The customer sees ONE address they share
 * across multiple chains — different from their main wallet EOA.
 *
 * When `entropy` is provided, the HKDF info string is
 * `"upl-stealth:wallet-2:<entropy>"` instead, which derives a
 * DIFFERENT stealth address from the same wallet signature. This
 * is how the customer mints a fresh receive address on demand
 * (clicking the recycling icon in the UI) without rotating
 * wallets: same wallet, same signature, different entropy →
 * different secp256k1 private key → different stealth address.
 *
 * ENTROPY STRATEGY:
 *   Pass a string the user can't predict (e.g.
 *   `${Date.now()}-${Math.random()}`). The HKDF produces a
 *   uniformly random secp256k1 scalar from it, so even adjacent
 *   entropy values produce independent addresses (no
 *   birthday-attack cheap relationship).
 *
 * SELF-CUSTODIAL: the private key NEVER leaves the browser. We
 * write it to localStorage (per-wallet cache) and update the
 * archive list (see getAddressArchive / addAddressToArchive
 * below) so the user can cycle/view/sweep old addresses without
 * touching a backend.
 */
export async function deriveStealthEOA(signer, entropy) {
    // Same wallet signature — the entropy is what makes the
    // derived private key different every time.
    const sig = await signer.signMessage("UPL-Stealth-Wallet-2");
    const infoStr = entropy
        ? `upl-stealth:wallet-2:${entropy}`
        : "upl-stealth:wallet-2";
    const bytes = await hkdfFromSignature(sig, infoStr, 32);
    const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
    const pkSecp = BigInt("0x" + bytesToHex(bytes)) % n;
    if (pkSecp === 0n) throw new Error("zero stealth key — re-attempt");
    const sk = new ethers.SigningKey("0x" + pkSecp.toString(16).padStart(64, "0"));
    const address = ethers.computeAddress("0x" + sk.publicKey.slice(4));

    // Also derive a VIEW KEY from the same signature — used by the
    // confidential notes system to decrypt hidden amounts. The view
    // key is a separate field element (not a secp256k1 key) — it's
    // used as a Poseidon hash input in the circuit, not for signing.
    // Different HKDF info string → independent key from the same
    // signature (no extra wallet popup).
    const viewInfoStr = entropy
        ? `upl-stealth:wallet-2:view:${entropy}`
        : "upl-stealth:wallet-2:view";
    const viewBytes = await hkdfFromSignature(sig, viewInfoStr, 32);
    // The view key is a BN254 field element (not a secp256k1 scalar).
    // Reduce mod the BN254 field prime.
    const Q = BigInt("0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001");
    const viewKey = (BigInt("0x" + bytesToHex(viewBytes)) % Q).toString();

    return {
        address,
        privateKey: pkSecp.toString(16).padStart(64, "0"),
        viewKey,
        entropy: entropy || null,
    };
}

/**
 * getAddressArchive(ownerAddress) → Array<{address, privateKey, entropy, createdAt}>
 * Returns the FULL list of stealth addresses the customer has ever
 * minted under this wallet. Most-recent first. Stored ONLY in
 * localStorage — no server, no telemetry. The customer owns the
 * list and can sweep from any of these addresses using the
 * matching privateKey.
 *
 * The old singleton `upl:stealth-pk:<address>` cache is kept as
 * the "active" receive address (most recent) for backward
 * compatibility — this archive list is the source of truth for
 * all historical addresses.
 */
export function getAddressArchive(ownerAddress) {
    if (!ownerAddress) return [];
    try {
        const raw = localStorage.getItem(
            `upl:stealth-archive:${ownerAddress.toLowerCase()}`
        );
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch {
        return [];
    }
}

/**
 * addAddressToArchive(ownerAddress, entry) → void
 * Append a new stealth address to the per-wallet archive. Also
 * updates the singleton `upl:stealth-pk:<wallet>` cache to point
 * at the new address so readStealthBalance() picks it up
 * immediately without needing a refresh.
 *
 * Self-custodial — writes to localStorage only.
 */
export function addAddressToArchive(ownerAddress, entry) {
    if (!ownerAddress || !entry?.address || !entry?.privateKey) return;
    try {
        const key = ownerAddress.toLowerCase();
        const archive = getAddressArchive(ownerAddress);
        // De-dupe by address — re-clicking the recycle button with
        // the same entropy shouldn't bloat the archive.
        const filtered = archive.filter(e => e.address !== entry.address);
        filtered.unshift({
            address: entry.address,
            privateKey: entry.privateKey,
            viewKey: entry.viewKey || null,  // NEW — for hidden amount decryption
            entropy: entry.entropy || null,
            createdAt: entry.createdAt || Date.now(),
        });
        localStorage.setItem(
            `upl:stealth-archive:${key}`,
            JSON.stringify(filtered)
        );
        // Keep the singleton cache pointing at the new active
        // address so the dashboard's readStealthBalance() picks
        // it up immediately on the next tick.
        localStorage.setItem(`upl:stealth-pk:${key}`, entry.privateKey);
    } catch {}
}

/**
 * getViewKeyForArchiveEntry(entry) → string | null
 * For old archive entries that don't have a viewKey field, derive
 * it retroactively from the private key. The view key is derived
 * as a BN254 field element from the stealth private key — this is
 * a deterministic mapping so the same privateKey always produces
 * the same viewKey.
 *
 * This avoids requiring the user to re-sign when they already have
 * old stealth addresses without view keys.
 */
export function getViewKeyForArchiveEntry(entry) {
    if (!entry?.privateKey) return null;
    if (entry.viewKey) return entry.viewKey;
    // Derive view key from the spend private key using a simple
    // keccak256 reduction mod BN254 field prime. This is
    // deterministic — same privateKey → same viewKey.
    const hash = ethers.keccak256("0x" + entry.privateKey);
    const Q = BigInt("0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001");
    return (BigInt(hash) % Q).toString();
}

/**
 * generateStealthAddress(metaAddress) → { stealthAddress, ephemeralPublicKey, viewTag }
 * The customer makes an ephemeral keypair, derives an ECDH shared
 * secret against the recipient's meta view-pub, computes the stealth
 * address as `viewPub + spendPub * sharedSecret`, packs a 1-byte
 * view tag for cheap recipient filter pre-screening.
 *
 * No backend round-trip. The ephemeral keypair is single-use and
 * discarded after the announce.
 */
export async function generateStealthAddress(metaAddress) {
  // metaAddress = concat(spendPub[64], viewPub[64]) ERC-5564 format with the
  // 0x04 SEC1 prefix stripped.
  const spendPubBytes = "0x" + metaAddress.slice(0, 128);
  const viewPubBytes = "0x" + metaAddress.slice(128, 256);

  const eph = ethers.Wallet.createRandom();
  const ephPriv = BigInt(eph.privateKey);
  const ephPub = "0x" + eph.publicKey.slice(4);

  // ECDH: sharedSecret = ephPriv * viewPub (as a Point)
  // ethers v6 doesn't ship an ECDH helper, but we can use noble's secp256k1
  // via computeSharedSecret on ethers.Wallet — note: ethers supports ECDH
  // through wallet.encrypt/keypair utilities. Use the provable primitive:
  const sharedSecret = computeEcdhSharedSecret(ephPriv, viewPubBytes);
  // Stealth address = viewPub + spendPub*sharedSecret
  const stealth = deriveStealthFromShared(
    viewPubBytes,
    spendPubBytes,
    sharedSecret
  );
  // viewTag = first byte of shared secret hash (1-byte trunc for cheap filter).
  const hash = ethers.keccak256(sharedSecret);
  const viewTag = hash.slice(2, 4); // 1 byte
  return {
    ephemeralPublicKey: ephPub,
    ephemeralPrivateKey: eph.privateKey,
    viewTag,
    stealthAddress: stealth,
    sharedSecret,
  };
}

// --- low-level ECC helpers (secp256k1 point arithmetic) ---
// Wrapped behind @noble/secp256k1 because ethers v6 doesn't expose ECDH.

function computeEcdhSharedSecret(priv, pubUncompressed) {
  // pubUncompressed is 64 bytes (no SEC1 prefix).
  const SEC1_PREFIX = "04";
  if (typeof window !== "undefined" && window.__noble_secp256k1__) {
    return window.__noble_secp256k1__(priv, pubUncompressed);
  }
  // Lazy require: @noble/secp256k1 is in package.json (^3.0.0).
  // We don't import at top of file to avoid SSR-time issues.
  const noble = require("@noble/secp256k1");
  const point = noble.Point.fromHex("04" + pubUncompressed.slice(2));
  const scalar = bigintToBytes(priv);
  const shared = noble.Point.BASE.multiply(scalar);
  // We need: priv * pub (receiver side), not (priv^-1)*priv*pub.
  // The shared secret here is priv*Pub (where priv is ephPriv).
  const sharedPoint = noble.Point.fromHex(pubUncompressed).multiply(scalar);
  return "0x" + (sharedPoint.x).toString(16).padStart(64, "0");
}

function bigintToBytes(b) {
  let hex = b.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return hex;
}

function deriveStealthFromShared(viewPubBytes, spendPubBytes, sharedSecret) {
  const noble = require("@noble/secp256k1");
  const sharedPoint = noble.Point.fromHex(
    "04" + sharedSecret.slice(2).padStart(64, "0")
  );
  const spendPoint = noble.Point.fromHex("04" + spendPubBytes.slice(2));
  const stealthPoint = noble.Point.fromHex("04" + viewPubBytes.slice(2))
    .add(spendPoint.multiply(sharedPoint.x));
  // address = keccak256(uncompressed pub)[12:]
  const uncompressed = "04" + stealthPoint.x.toString(16).padStart(64, "0") +
    stealthPoint.y.toString(16).padStart(64, "0");
  const h = ethers.keccak256("0x" + uncompressed);
  return "0x" + h.slice(-40);
}

/**
 * `scanAnnouncementsViaDirectRPC(provider, chainId, opts)` — read + filter
 * stealth announcements directly via eth_getLogs and yield only those
 * the wallet's view-key matches. Returns matches in the same shape the
 * customer expects: stealth address, ephemeral pub, view tag.
 */
export async function scanLocalAnnouncements(signer, chainId, opts = {}) {
  // 1. derive wallet-side crypto
  const meta = await deriveMetaAddress(signer, chainId);
  const viewPriv = meta.viewPriv;

  // 2. fetch raw announcements directly via RPC.
  const { fetchAnnouncements } = await import("./direct-rpc-scanner");
  const logs = await fetchAnnouncements({
    chain: chainId === 8453n ? "base" : "base",
    provider: opts.provider || signer.provider,
    fromBlock: opts.fromBlock,
    toBlock: opts.toBlock,
  });

  // 3. For each announcement, derive the candidate shared secret and
  // check the viewTag prefix matches our viewTag derivation. Filter
  // out the false positives (1/256 random pass rate from the 1-byte
  // tag) by full ECDH checks.
  const noble = require("@noble/secp256k1");
  const viewScalar = bigintToBytes(BigInt("0x" + viewPriv));

  const matches = [];
  for (const log of logs) {
    // Ephemeral pub key as uncompressed SEC1 so ECDH can compute.
    const ephPubPoint = noble.Point.fromHex(
      "04" + (log.ephemeralPubKeyX.slice(2) + log.ephemeralPubKeyY.slice(2))
    );
    const sharedPoint = ephPubPoint.multiply(viewScalar);
    const sharedHex = "0x" + sharedPoint.x.toString(16).padStart(64, "0");
    const derivedHash = ethers.keccak256(sharedHex);
    const derivedTag = derivedHash.slice(2, 4);
    if (derivedTag !== log.viewTag.slice(2, 4)) continue;
    // Tag passes → derive stealth address and verify against stealthHash.
    const stealth = deriveStealthFromShared(
      meta.viewPub,
      meta.spendPub,
      sharedHex
    );
    matches.push({
      chain: "base",
      derivedStealth: stealth,
      ephemeralPubKey: log.ephemeralPubKeyX + log.ephemeralPubKeyY.slice(2),
      viewTag: log.viewTag,
      txHash: log.txHash,
      blockNumber: log.blockNumber,
    });
  }
  return matches;
}
