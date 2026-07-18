#!/usr/bin/env node
/**
 * Generate a real Groth16 proof for the confidential_notes circuit.
 * This circuit has NO public recipient — only 4 public signals.
 *
 * Output: Solidity constants for forge tests.
 */
const path = require("path");
const fs = require("fs");

(async () => {
  const snarkjs = require("snarkjs");
  const circomlib = require("circomlibjs");

  const poseidon = await circomlib.buildPoseidonOpt();
  const F = poseidon.F;
  const MERKLE_DEPTH = 20;

  // Zero subtrees
  const zeros = [BigInt(0)];
  for (let i = 1; i <= MERKLE_DEPTH; i++) {
    zeros.push(BigInt(F.toObject(poseidon([zeros[i-1], zeros[i-1]]))));
  }

  // Tree
  let filledSubtrees = zeros.slice(0, MERKLE_DEPTH).map(z => BigInt(z));
  let nextLeafIndex = 0;

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
    return current;
  }

  // Witness values
  const nullifier = BigInt(0x12345);
  const secret = BigInt(0x67890);
  const amount = BigInt(1000000); // 1 USDC
  const blindingFactor = BigInt(0xabc123);
  const recipientViewKey = BigInt(0x0B0B); // PRIVATE — not on-chain

  // Compute commitments
  const commitment = BigInt(F.toObject(poseidon([nullifier, secret])));
  const nullifierHash = BigInt(F.toObject(poseidon([nullifier])));

  // newCommitment = Poseidon(3)(amount, blindingFactor, recipientViewKey)
  const newCommitment = BigInt(F.toObject(poseidon([amount, blindingFactor, recipientViewKey])));

  // encryptedAmount = Poseidon(2)(amount, recipientViewKey)
  const encryptedAmount = BigInt(F.toObject(poseidon([amount, recipientViewKey])));

  console.error("Commitment:", F.toString(F.e(commitment)));
  console.error("NullifierHash:", F.toString(F.e(nullifierHash)));
  console.error("NewCommitment:", F.toString(F.e(newCommitment)));
  console.error("EncryptedAmount:", F.toString(F.e(encryptedAmount)));

  // Insert commitment
  const root = insert(commitment);
  console.error("Root:", F.toString(F.e(root)));

  // Merkle path (for index 0, all zeros)
  const merklePathElements = [];
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    merklePathElements.push(F.toString(F.e(zeros[i])));
  }

  // Circuit input
  const input = {
    root: F.toString(F.e(root)),
    nullifier: F.toString(F.e(nullifier)),
    secret: F.toString(F.e(secret)),
    amount: F.toString(F.e(amount)),
    blindingFactor: F.toString(F.e(blindingFactor)),
    recipientViewKey: F.toString(F.e(recipientViewKey)),
    merklePathElements: merklePathElements,
    merklePathIndices: new Array(MERKLE_DEPTH).fill('0'),
  };

  const wasmPath = path.join(__dirname, "..", "..", "frontend", "public", "zk-pool", "confidential_notes.wasm");
  const zkeyPath = path.join(__dirname, "..", "..", "frontend", "public", "zk-pool", "notes_final.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

  console.error("Public signals (4 — NO recipient):", publicSignals);

  // Use raw proof values — snarkjs pi_a, pi_b, pi_c are already
  // in the correct format for the Solidity verifier.
  const a0 = proof.pi_a[0].toString();
  const a1 = proof.pi_a[1].toString();
  // pi_b is [[b00, b01], [b10, b11]] — swap the pairs for Solidity
  const b00 = proof.pi_b[0][1].toString();
  const b01 = proof.pi_b[0][0].toString();
  const b10 = proof.pi_b[1][1].toString();
  const b11 = proof.pi_b[1][0].toString();
  const c0 = proof.pi_c[0].toString();
  const c1 = proof.pi_c[1].toString();

  // Verify the proof is valid before emitting constants
  const vkeyPath2 = path.join(__dirname, "..", "..", "frontend", "public", "zk-pool", "notes_verification_key.json");
  const vkey2 = JSON.parse(fs.readFileSync(vkeyPath2, "utf8"));
  const isValid = await snarkjs.groth16.verify(vkey2, publicSignals, proof);
  console.error("Proof valid:", isValid);
  if (!isValid) throw new Error("Proof verification failed");

  const output = `
uint256 internal constant CN_NULLIFIER_HASH = ${publicSignals[0]};
uint256 internal constant CN_NEW_COMMITMENT = ${publicSignals[1]};
uint256 internal constant CN_ENCRYPTED_AMOUNT = ${publicSignals[2]};
uint256 internal constant CN_ROOT = ${publicSignals[3]};

uint256 internal constant CN_PA0 = ${a0};
uint256 internal constant CN_PA1 = ${a1};
uint256 internal constant CN_PB00 = ${b00};
uint256 internal constant CN_PB01 = ${b01};
uint256 internal constant CN_PB10 = ${b10};
uint256 internal constant CN_PB11 = ${b11};
uint256 internal constant CN_PC0 = ${c0};
uint256 internal constant CN_PC1 = ${c1};

uint256 internal constant CN_AMOUNT = ${amount};
uint256 internal constant CN_NULLIFIER = ${nullifier};
uint256 internal constant CN_SECRET = ${secret};
uint256 internal constant CN_BLINDING = ${blindingFactor};
uint256 internal constant CN_RECIPIENT_VIEW_KEY = ${recipientViewKey};
uint256 internal constant CN_COMMITMENT = ${F.toString(F.e(commitment))};
`;

  console.log(output);

  const outPath = path.join(__dirname, "notes_proof_constants.txt");
  fs.writeFileSync(outPath, output);
  console.error("Written to:", outPath);

  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
