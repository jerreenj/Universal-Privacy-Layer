#!/usr/bin/env node
/**
 * snarkjs ffi helper for the Foundry PrivacyPoolBaseFork.t.sol test.
 *
 * Invoked by Foundry via:
 *   vm.ffi(["node", "scripts/prove_withdraw_ffi.js",
 *                  <input.json path>, <build dir>, <output dir>])
 *
 * Reads a circom witness input (nullifier, secret, root, recipient,
 * merklePathElements[], merklePathIndices[]) from the input file,
 * generates the witness via the circom wasm, then runs snarkjs
 * groth16.prove against the on-disk proving key, and writes the
 * proof + publicSignals JSON to <output dir>/proof.json.
 *
 * Prints "OK" on success.
 */

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function die(msg) { console.error("[prove_withdraw_ffi] " + msg); process.exit(1); }

const inputPath  = process.argv[2];
const buildDir   = process.argv[3];
const outDir     = process.argv[4];

if (!inputPath || !buildDir || !outDir) {
  die("usage: prove_withdraw_ffi.js <input.json> <build dir> <out dir>");
}
if (!fs.existsSync(path.join(buildDir, "withdraw_js", "withdraw.wasm"))) {
  die(`withdraw.wasm not found at ${path.join(buildDir, "withdraw_js")}`);
}
if (!fs.existsSync(path.join(buildDir, "withdraw_final.zkey"))) {
  die(`withdraw_final.zkey not found at ${buildDir}`);
}

fs.mkdirSync(outDir, { recursive: true });

const input  = JSON.parse(fs.readFileSync(inputPath));
const tmpwt  = path.join(outDir, "_tmp.wtns");
const proofF = path.join(outDir, "proof.json");
const pubF   = path.join(outDir, "public.json");
const finalF = path.join(outDir, "withdraw_proof.json");

// 1. Generate the witness via the circom-generated JS helper.
const genWitness = path.join(buildDir, "withdraw_js", "generate_witness.js");
execFileSync("node", [genWitness, path.join(buildDir, "withdraw_js", "withdraw.wasm"),
                       inputPath, tmpwt], { stdio: "pipe" });

// 2. Run snarkjs groth16.prove — emits proof.json + public.json files
//    alongside the output directory.
execFileSync("snarkjs", ["groth16", "prove",
                          path.join(buildDir, "withdraw_final.zkey"),
                          tmpwt, proofF, pubF], { stdio: "pipe" });

const proof = JSON.parse(fs.readFileSync(proofF));
const pub   = JSON.parse(fs.readFileSync(pubF));

// 3. Re-emit a single combined file the Forge test reads.
fs.writeFileSync(finalF, JSON.stringify({
  a: [proof.pi_a[0], proof.pi_a[1]],
  b: [[proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]]],  // swap for EVM word-order
  c: [proof.pi_c[0], proof.pi_c[1]],
  publicSignals: pub,
}, null, 2));

console.log("OK");
