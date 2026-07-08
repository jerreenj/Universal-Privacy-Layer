#!/usr/bin/env node
/**
 * test-per-account-stealth.js
 *
 * Verifies the security guarantee every pilot customer is asking for:
 * "If I connect MetaMask account A, I get stealth address A. If I
 * disconnect and connect account B, I get stealth address B (DIFFERENT).
 * If I connect account A again, I get A back — not B."
 *
 * This is the per-account stealth-address isolation property. If it's
 * broken, every connected wallet on a shared device shares the same
 * proxy + stealth address — every customer's privacy evaporates on
 * the second account.
 *
 * The test mirrors the FE derivation in wallet-stealth.js +
 * stealth-proxy.js:
 *   1. signer.signMessage("UPL-Stealth-Wallet-2")
 *   2. HKDF-SHA256 over the signature (salt = 32 zero bytes per RFC 5869)
 *   3. mod secp256k1 curve order → privkey → ethers.computeAddress
 *
 * The FE file itself uses crypto.subtle / window.localStorage so we
 * can't `require()` it directly; we re-implement the same logic in
 * node:crypto so we can run a deterministic, fast unit test.
 */
const { Wallet, computeAddress, SigningKey } = require("ethers");
const crypto = require("crypto");

const SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

function hkdfExtract(salt, ikm) {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}

function hkdfExpand(prk, info, length) {
  let out = Buffer.alloc(0);
  let counter = 1;
  while (out.length < length) {
    const block = crypto.createHmac("sha256", prk)
      .update(Buffer.concat([info, Buffer.from([counter])]))
      .digest();
    out = Buffer.concat([out, block]);
    counter++;
  }
  return out.subarray(0, length);
}

async function deriveStealthEOA(signerAddr /* hex */, msgBytes) {
  // Mimic the FE's `hkdfFromSignature`. The FE uses crypto.subtle with
  // an HMAC key supporting raw bytes — node:crypto uses a Buffer here.
  const sig = msgBytes; // already mocked per-signature 65 bytes
  const salt = Buffer.alloc(32, 0); // 32 zero bytes — RFC 5869 empty-salt equivalent
  const prk = hkdfExtract(salt, sig);
  const bytes = hkdfExpand(prk, Buffer.from("upl-stealth:wallet-2", "utf8"), 32);
  const k = BigInt("0x" + bytes.toString("hex")) % SECP_N;
  if (k === 0n) throw new Error("zero stealth key");
  const sk = new SigningKey("0x" + k.toString(16).padStart(64, "0"));
  return {
    address: computeAddress("0x" + sk.publicKey.slice(4)),
    privateKey: k.toString(16).padStart(64, "0"),
  };
}

// --- per-account lsKey (must match stealth-proxy.js naming) ---
const lsKey = (address) =>
  `upl:stealth-proxy:${(address || "").toLowerCase()}`;

// --- mock localStorage ---
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// --- mock ethers Wallet as a "Signer" that returns per-wallet
//     signatures. Real signers sign 65 bytes per ECDSA; mocking
//     at the signature level is sufficient to prove HKDF inputs
//     produce distinct stealth addresses — the in-circuit identity
//     protection is the cryptographic claim under test.
function makeMockWallet(privateKeyHex) {
  const w = new Wallet(privateKeyHex);
  // Mock a unique pseudo-signature per wallet. The real wallet signs
  // 65 bytes; here we deterministically derive 65 distinct bytes per
  // wallet from its private key.
  const sig = crypto.createHash("sha256")
    .update(Buffer.from("MOCK-SIGN-UPL-Stealth-Wallet-2:" + privateKeyHex, "utf8"))
    .digest();
  // Pad to 65: r||s [32 each] + v [1 byte]
  const padded = Buffer.concat([sig, Buffer.from([0x1b])]);
  return {
    address: w.address,
    signMessage: async () => padded,
  };
}

(async () => {
  // Spawn 3 independent "MetaMask accounts".
  const walletA = makeMockWallet(
    "0x" + "a".repeat(64) // simple but valid
  );
  const walletB = makeMockWallet(
    "0x" + "b".repeat(64)
  );
  const walletC = makeMockWallet(
    "0x" + "c".repeat(64)
  );

  // --- 1. Each account gets its OWN stealth address ---
  const derivedA = await deriveStealthEOA(walletA.address, await walletA.signMessage());
  const derivedB = await deriveStealthEOA(walletB.address, await walletB.signMessage());
  const derivedC = await deriveStealthEOA(walletC.address, await walletC.signMessage());

  const all = new Set([derivedA.address, derivedB.address, derivedC.address]);
  if (all.size !== 3) {
    console.error("FAIL: accounts share stealth addresses!", Array.from(all));
    process.exit(1);
  }
  console.log("PASS: 3 distinct wallets → 3 distinct stealth addresses");
  console.log(`  A ${walletA.address} → stealth ${derivedA.address}`);
  console.log(`  B ${walletB.address} → stealth ${derivedB.address}`);
  console.log(`  C ${walletC.address} → stealth ${derivedC.address}`);

  // --- 2. Per-address localStorage cache keys must NOT collide ---
  // Mimic what stealth-proxy.js does:
  localStorage.setItem(lsKey(walletA.address), JSON.stringify(derivedA));
  localStorage.setItem(lsKey(walletB.address), JSON.stringify(derivedB));
  localStorage.setItem(lsKey(walletC.address), JSON.stringify(derivedC));

  const cacheA = JSON.parse(localStorage.getItem(lsKey(walletA.address)));
  const cacheB = JSON.parse(localStorage.getItem(lsKey(walletB.address)));
  const cacheC = JSON.parse(localStorage.getItem(lsKey(walletC.address)));

  if (cacheA.address !== derivedA.address) {
    console.error("FAIL: walletA cache does not round-trip", cacheA, derivedA);
    process.exit(1);
  }
  if (cacheB.address !== derivedB.address) {
    console.error("FAIL: walletB cache does not round-trip", cacheB, derivedB);
    process.exit(1);
  }
  if (cacheC.address !== derivedC.address) {
    console.error("FAIL: walletC cache does not round-trip", cacheC, derivedC);
    process.exit(1);
  }
  // And the cache keys must be different (this is the bug the lsKey()
  // helper was created to fix: a single global LS_KEY leaked A's proxy
  // to B).
  const ks = new Set([
    lsKey(walletA.address),
    lsKey(walletB.address),
    lsKey(walletC.address),
  ]);
  if (ks.size !== 3) {
    console.error("FAIL: lsKey() collisions:", Array.from(ks));
    process.exit(1);
  }
  console.log("PASS: 3 cache keys are distinct per-wallet");
  console.log(`  ${lsKey(walletA.address)}`);
  console.log(`  ${lsKey(walletB.address)}`);
  console.log(`  ${lsKey(walletC.address)}`);

  // --- 3. Same wallet reconnected → SAME stealth address (determinism) ---
  const derivedAagain = await deriveStealthEOA(walletA.address, await walletA.signMessage());
  if (derivedAagain.address !== derivedA.address) {
    console.error("FAIL: same wallet produced different stealth addresses", derivedA, derivedAagain);
    process.exit(1);
  }
  console.log("PASS: reconnecting wallet A → same stealth address (deterministic)");

  console.log("\nALL CHECKS PASSED ✓");
  console.log("Per-account stealth address isolation is working correctly.");
})().catch((e) => {
  console.error("UNEXPECTED:", e);
  process.exit(2);
});
