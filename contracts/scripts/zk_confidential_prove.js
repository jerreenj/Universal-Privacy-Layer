#!/usr/bin/env node
/**
 * Generate a real Groth16 proof for the confidential_transfer circuit
 * for use in forge tests. Builds the same incremental Poseidon Merkle
 * tree the contract uses, deposits a note, then proves a transfer.
 *
 * Output: writes proof + public signals as Solidity constants to stdout.
 */
const path = require("path");
const fs = require("fs");

(async () => {
  let snarkjs;
  try {
    snarkjs = require("snarkjs");
  } catch {
    snarkjs = await import("snarkjs");
    snarkjs = snarkjs.default || snarkjs;
  }

  // circomlibjs for Poseidon
  let circomlib;
  try {
    circomlib = require("circomlibjs");
  } catch {
    console.error("circomlibjs not installed. Run: npm install circomlibjs");
    process.exit(1);
  }

  const poseidon = await circomlib.buildPoseidonOpt();
  const F = poseidon.F;

  // ─── Tree parameters ──────────────────────────────────────────
  const MERKLE_DEPTH = 20;

  // ─── Zero subtrees (same as contract) ─────────────────────────
  const zeros = [BigInt(0)];
  for (let i = 1; i <= MERKLE_DEPTH; i++) {
    zeros.push(BigInt(F.toObject(poseidon([zeros[i - 1], zeros[i - 1]]))));
  }

  // ─── Incremental Merkle tree (same as contract _insert) ──────
  let filledSubtrees = zeros.slice(0, MERKLE_DEPTH).map((z) => BigInt(z));
  let nextLeafIndex = 0;
  let currentRoot = BigInt(zeros[MERKLE_DEPTH]);
  let roots = [currentRoot];

  function insert(leaf) {
    let current = BigInt(leaf);
    let index = nextLeafIndex;
    for (let l = 0; l < MERKLE_DEPTH; l++) {
      let isRight = ((BigInt(index) >> BigInt(l)) & BigInt(1)) === BigInt(1);
      if (isRight) {
        let left = filledSubtrees[l];
        filledSubtrees[l] = zeros[l];
        current = BigInt(F.toObject(poseidon([BigInt(left), current])));
      } else {
        filledSubtrees[l] = current;
        current = BigInt(F.toObject(poseidon([current, BigInt(zeros[l])])));
      }
    }
    nextLeafIndex++;
    currentRoot = current;
    roots.push(current);
    return current;
  }

  // ─── Generate witness values ──────────────────────────────────
  const nullifier = BigInt("0x12345");
  const secret = BigInt("0x67890");
  const amount = BigInt(1000000); // 1 USDC (6 decimals)
  const blindingFactor = BigInt("0xabc123");
  const recipient = BigInt("0x0B0B");

  // Compute commitments
  const commitment = BigInt(F.toObject(poseidon([nullifier, secret])));
  const nullifierHash = BigInt(F.toObject(poseidon([nullifier])));
  const newCommitment = BigInt(F.toObject(poseidon([amount, blindingFactor])));
  const encryptedAmount = BigInt(F.toObject(poseidon([amount, recipient])));

  console.error("Commitment:", F.toString(F.e(commitment)));
  console.error("NullifierHash:", F.toString(F.e(nullifierHash)));
  console.error("NewCommitment:", F.toString(F.e(newCommitment)));
  console.error("EncryptedAmount:", F.toString(F.e(encryptedAmount)));

  // Insert the commitment into the tree
  const root = insert(commitment);
  console.error("Root:", F.toString(F.e(root)));

  // ─── Compute Merkle path ──────────────────────────────────────
  // Rebuild the path for leaf at index 0
  // We need to recompute the path siblings at the time of insertion
  // Since this is the first leaf (index 0), all siblings are zeros
  const merklePathElements = [];
  const merklePathIndices = [];

  // For index 0, all path indices are 0 (leaf is always left child)
  // and all siblings are the zero hashes
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    merklePathElements.push(F.toString(F.e(zeros[i])));
    merklePathIndices.push("0");
  }

  // ─── Build circuit input ──────────────────────────────────────
  const input = {
    root: F.toString(F.e(root)),
    recipient: F.toString(F.e(recipient)),
    nullifier: F.toString(F.e(nullifier)),
    secret: F.toString(F.e(secret)),
    amount: F.toString(F.e(amount)),
    blindingFactor: F.toString(F.e(blindingFactor)),
    merklePathElements: merklePathElements,
    merklePathIndices: merklePathIndices,
  };

  // ─── Generate proof ───────────────────────────────────────────
  const wasmPath = path.join(
    __dirname,
    "..",
    "circuits",
    "build",
    "confidential_transfer_build",
    "confidential_transfer_js",
    "confidential_transfer.wasm"
  );
  const zkeyPath = path.join(
    __dirname,
    "..",
    "circuits",
    "build",
    "confidential_transfer_build",
    "confidential_final.zkey"
  );

  console.error("WASM:", wasmPath);
  console.error("ZKEY:", zkeyPath);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  console.error("Public signals:", publicSignals);

  // ─── Export as Solidity constants ─────────────────────────────
  const a = proof.pi_a;
  const b = proof.pi_b;
  const c = proof.pi_c;

  // snarkjs pi_b is [[b[0][0], b[0][1]], [b[1][0], b[1][1]]]
  // Solidity expects [[b[0][1], b[0][0]], [b[1][1], b[1][0]]] (swapped)
  // Actually snarkjs exportSolidityCallData handles the ordering.
  // For forge tests we use the raw snarkjs ordering and let the verifier handle it.

  const output = `
// ─── Auto-generated proof for ConfidentialVault forge test ─────────
// Generated by scripts/zk_confidential_prove.js
// DO NOT EDIT — regenerate if the circuit or inputs change.

uint256 internal constant CT_NULLIFIER_HASH = ${publicSignals[0]};
uint256 internal constant CT_NEW_COMMITMENT = ${publicSignals[1]};
uint256 internal constant CT_ENCRYPTED_AMOUNT = ${publicSignals[2]};
uint256 internal constant CT_ROOT = ${publicSignals[3]};
uint256 internal constant CT_RECIPIENT = ${publicSignals[4]};

uint256 internal constant CT_PA0 = ${a[0]};
uint256 internal constant CT_PA1 = ${a[1]};
uint256 internal constant CT_PB00 = ${b[0][0]};
uint256 internal constant CT_PB01 = ${b[0][1]};
uint256 internal constant CT_PB10 = ${b[1][0]};
uint256 internal constant CT_PB11 = ${b[1][1]};
uint256 internal constant CT_PC0 = ${c[0]};
uint256 internal constant CT_PC1 = ${c[1]};

uint256 internal constant CT_AMOUNT = ${amount};
uint256 internal constant CT_NULLIFIER = ${nullifier};
uint256 internal constant CT_SECRET = ${secret};
uint256 internal constant CT_BLINDING = ${blindingFactor};
uint256 internal constant CT_COMMITMENT = ${F.toString(F.e(commitment))};
`;

  console.log(output);

  // Also write to a file for easy copy-paste
  const outPath = path.join(__dirname, "confidential_proof_constants.txt");
  fs.writeFileSync(outPath, output);
  console.error("Written to:", outPath);

  // Verify the proof
  const vkeyPath = path.join(
    __dirname,
    "..",
    "circuits",
    "build",
    "confidential_transfer_build",
    "confidential_verification_key.json"
  );
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.error("Proof valid:", isValid);

  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
