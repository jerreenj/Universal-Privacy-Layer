#!/usr/bin/env node
/**
 * zk_pool_prover.js — Server-side Groth16 prover for the Base PrivacyPool.
 * Called by the backend's `/api/zk-pool/prove` endpoint to offload the
 * 5-20s snarkjs WASM generation from the browser (Gap 3 of the
 * Base-Privacy-Pilot closer list: backend-prover fallback so the
 * customer's UX is "snappier" without compromising trust — the proof
 * generation key (zkey) is the only thing needed, and this script is a
 * thin wrapper around snarkjs.groth16.fullProve).
 *
 * Inputs (stdin JSON):
 *   {
 *     nullifier:            "0x<32-byte-hex>",
 *     secret:               "0x<32-byte-hex>",
 *     pathElements:         ["0x...", ...20...],
 *     pathIndices:          [0|1, ...20...],
 *     root:                 "0x<32-byte-hex>",
 *     recipient:            "0x<20-byte-hex-padded-to-32>",
 *     zkeyPath:             "/abs/path/to/withdraw_final.zkey",
 *     wasmPath:             "/abs/path/to/withdraw_js/withdraw.wasm"
 *   }
 *
 * Output (stdout JSON):
 *   {
 *     proof:  { pi_a, pi_b, pi_c },  // raw groth16 shape
 *     publicSignals: ["0x...", "0x...", "0x..."]  // [nullifierHash, root, recipient]
 *   }
 *
 * Exit codes:
 *   0 — proof generated successfully
 *   1 — invalid input JSON / missing field
 *   2 — snarkjs witness generation failed
 *   3 — snarkjs proof generation failed
 */

const fs = require("fs");

(async () => {
  let payload;
  try {
    const stdin = await readAllStdin();
    payload = JSON.parse(stdin);
  } catch (e) {
    console.error("zk_pool_prover: invalid stdin JSON:", e.message);
    process.exit(1);
  }

  const required = [
    "nullifier", "secret",
    "pathElements", "pathIndices",
    "root", "recipient",
    "zkeyPath", "wasmPath",
  ];
  for (const k of required) {
    if (payload[k] === undefined || payload[k] === null) {
      console.error(`zk_pool_prover: missing required field ${k}`);
      process.exit(1);
    }
  }

  // snarkjs is heavy — load only after input validation so the error
  // path is fast.
  let snarkjs;
  try {
    snarkjs = require("snarkjs");
  } catch (e) {
    console.error(
      "zk_pool_prover: snarkjs not installed on backend. Install via " +
      "`cd backend && npm install snarkjs` (or set ZK_POOL_PROVER_ENABLED=0 " +
      "to disable). Run-time path:",
      e.message
    );
    process.exit(2);
  }

  // Build the circuit input. withdraw.circom expects:
  //   nullifier, secret          -> 2 private scalars
  //   merklePathElements[20]     -> 20 path siblings
  //   merklePathIndices[20]      -> 20 bit indices
  //   root, recipient            -> 2 public signals
  //   (commitment + nullifierHash are derived in-circuit)
  const input = {
    nullifier:           payload.nullifier,
    secret:              payload.secret,
    merklePathElements:  payload.pathElements,
    merklePathIndices:   payload.pathIndices,
    root:                payload.root,
    recipient:           payload.recipient,
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      payload.wasmPath,
      payload.zkeyPath
    );
    process.stdout.write(JSON.stringify({ proof, publicSignals }));
    process.exit(0);
  } catch (e) {
    console.error("zk_pool_prover: fullProve failed:", e.message || e);
    process.exit(3);
  }
})();

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let chunks = [];
    process.stdin.on("data", c => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", err => reject(err));
  });
}
