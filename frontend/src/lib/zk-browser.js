// P3.6 — Browser-side ZK helpers for the PrivacyPool.
// Loads snarkjs + circomlibjs from the public/zk-pool/ static asset bundle
// (so we don't touch package.json — the Dockerfile uses `--frozen-lockfile`).
//
// Why static assets and not npm imports:
//   - yarn install --frozen-lockfile would fail if we add deps without yarn.lock
//   - snarkjs's Node imports break the CRA webpack polyfill config out of the box
//   - A 5MB .zkey and 2MB .wasm are exactly what `public/*` exists for
//     (served as static files, cached by the CDN/ACA)

export const ZK_ASSETS_BASE = "/zk-pool";

// Lazily load snarkjs (UMD bundle dropped at public/zk-pool/snarkjs.min.js).
// If the bundle is not present, we throw a clear error so the UI shows
// "ZK bundle not installed yet" instead of crashing.
let _snarkjsPromise = null;
export function loadSnarkjs() {
  if (_snarkjsPromise) return _snarkjsPromise;
  _snarkjsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("snarkjs requires browser"));
    if (window.snarkjs) return resolve(window.snarkjs);
    const s = document.createElement("script");
    s.src = `${ZK_ASSETS_BASE}/snarkjs.bundle.js`;
    s.async = true;
    s.onload = () => resolve(window.snarkjs);
    s.onerror = () => reject(new Error("Failed to load /zk-pool/snarkjs.bundle.js — run scripts/build_zk_browser.sh"));
    document.head.appendChild(s);
  });
  return _snarkjsPromise;
}

// Lazily load circomlibjs for Poseidon (also a UMD bundle at public/zk-pool/).
let _circomlibPromise = null;
export function loadCircomlib() {
  if (_circomlibPromise) return _circomlibPromise;
  _circomlibPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("circomlibjs requires browser"));
    if (window.circomlibjs) return resolve(window.circomlibjs);
    const s = document.createElement("script");
    s.src = `${ZK_ASSETS_BASE}/circomlibjs.bundle.js`;
    s.async = true;
    s.onload = () => resolve(window.circomlibjs);
    s.onerror = () => reject(new Error("Failed to load /zk-pool/circomlibjs.bundle.js"));
    document.head.appendChild(s);
  });
  return _circomlibPromise;
}

// 32-byte hex random (browser-safe)
export function randomFieldElement() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  // Reduce mod BN254 field size to ensure it's a valid field element.
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  // Use BigInt to keep things clean
  const n = BigInt("0x" + s);
  const Q = BigInt("0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001");
  return (n % Q).toString();
}

// Compute commitment = Poseidon(nullifier, secret) using circomlibjs
export async function computeCommitment(nullifier, secret) {
  const lib = await loadCircomlib();
  const poseidon = await lib.buildPoseidon();
  const F = poseidon.F;
  const h = poseidon([BigInt(nullifier), BigInt(secret)]);
  return F.toString(h);
}

// Compute nullifierHash = Poseidon(nullifier) (Poseidon with 1 input)
export async function computeNullifierHash(nullifier) {
  const lib = await loadCircomlib();
  const poseidon = await lib.buildPoseidon();
  const F = poseidon.F;
  const h = poseidon([BigInt(nullifier)]);
  return F.toString(h);
}

// Generate the snarkjs Groth16 proof in the browser.
// Requires: nullifier, secret, merklePathElements, merklePathIndices, root, recipient.
// Backend already returns these in /api/zk-pool/state via the deposits it knows.
export async function generateWithdrawProof({
  nullifier,
  secret,
  root,
  recipient,
  merklePathElements,
  merklePathIndices,
}) {
  const snarkjs = await loadSnarkjs();
  const input = {
    root: String(root),
    recipient: BigInt(recipient).toString(),
    nullifier: String(nullifier),
    secret: String(secret),
    merklePathElements: merklePathElements.map(String),
    merklePathIndices: merklePathIndices.map(String),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${ZK_ASSETS_BASE}/withdraw.wasm`,
    `${ZK_ASSETS_BASE}/withdraw_final.zkey`
  );
  return { proof, publicSignals };
}

// ─── P2: Confidential transfer proof ───────────────────────────
// Generates a Groth16 proof for the confidential_transfer circuit.
// The amount is a PRIVATE input — it never appears in the public
// signals. The EVM verifies the proof without seeing the amount.
//
// Private inputs: nullifier, secret, amount, blindingFactor,
//                 merklePathElements[20], merklePathIndices[20]
// Public inputs:  root, recipient
// Public outputs: nullifierHash, newCommitment, encryptedAmount
//
// snarkjs publicSignals order: [nullifierHash, newCommitment,
// encryptedAmount, root, recipient]
export async function generateConfidentialTransferProof({
  nullifier,
  secret,
  amount,
  blindingFactor,
  root,
  recipient,
  merklePathElements,
  merklePathIndices,
}) {
  const snarkjs = await loadSnarkjs();
  const input = {
    root: String(root),
    recipient: BigInt(recipient).toString(),
    nullifier: String(nullifier),
    secret: String(secret),
    amount: String(amount),
    blindingFactor: String(blindingFactor),
    merklePathElements: merklePathElements.map(String),
    merklePathIndices: merklePathIndices.map(String),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${ZK_ASSETS_BASE}/confidential_transfer.wasm`,
    `${ZK_ASSETS_BASE}/confidential_final.zkey`
  );
  return { proof, publicSignals };
}

// Helper to fetch the pool state (root, denomination, recent roots) from
// the backend. Pass an optional `denomination` (wei string) to scope the
// response to a specific sub-pool — same query semantics as the backend
// route's ?denomination=… param.
export async function fetchPoolState(denomination) {
  const { API } = await import("@/config/chains");
  const axios = (await import("axios")).default;
  const url = denomination
    ? `${API}/zk-pool/state?denomination=${encodeURIComponent(denomination)}`
    : `${API}/zk-pool/state`;
  const res = await axios.get(url);
  return res.data;
}

// Normalise the pool-state payload into a single multi-denom shape.
// Backend already returns the canonical multi-denom shape since P4.1
// (denominations[] + perDenomination{...} + defaultDenomination); the
// legacy single-denom shape is still served for pre-P4.1 deploys as a
// back-compat fallback. We always project to multi-denom so the
// consumer (ZKCommitments.jsx, ZKPProofs.jsx) only has one code path.
export function normalisePoolState(raw) {
  if (!raw || typeof raw !== "object" || !raw.live) {
    return raw || { live: false, kind: "unknown" };
  }
  if (raw.kind === "multi-denom") {
    return raw; // canonical shape — pass through
  }
  // Legacy single-denom: project to multi-denom with one element.
  const denom = raw.denomination;
  return {
    live: true,
    chain: raw.chain,
    chainId: raw.chainId,
    privacy_pool: raw.privacy_pool,
    verifier: raw.verifier,
    kind: "multi-denom",
    denominations: denom ? [String(denom)] : [],
    defaultDenomination: denom ? String(denom) : null,
    merkleDepth: raw.merkleDepth ?? 20,
    rootHistorySize: raw.rootHistorySize ?? 100,
    perDenomination: denom
      ? {
          [String(denom)]: {
            currentRoot:    raw.currentRoot,
            onchainRoot:    raw.onchainRoot,
            nextLeafIndex:  raw.nextLeafIndex,
            storedDeposits: raw.storedDeposits ?? 0,
          },
        }
      : {},
  };
}
