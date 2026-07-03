// P3.1 gate: generate a SATISFIABLE witness for withdraw.circom and run a full
// Groth16 prove -> verify round-trip. Computes the real Poseidon Merkle root +
// path using circomlibjs (matches the circuit's Poseidon BN254 params), so the
// generated proof actually verifies — unlike a hand-faked input.
//
// Run inside the circuits dir after `circom withdraw.circom --r1cs --wasm`:
//   node /path/to/zk_smoke.js
const circomlibjs = require("circomlibjs");
// Resolve the snarkjs npm module (not the global CLI shim). SMOKE_MODULE_DIR is
// set by the runner to point at the dir where snarkjs is npm-installed.
const snarkjs = require(process.env.SMOKE_MODULE_DIR
  ? `${process.env.SMOKE_MODULE_DIR}/node_modules/snarkjs`
  : "snarkjs");
const path = require("path");
const fs = require("fs");

const MERKLE_DEPTH = 20;

// Recompute the root a depth-20 incremental Merkle tree would have if the only
// deposited leaf sat at index 0, with every empty sibling being the zero-hash
// chain (Poseidon^k(0)). This mirrors PrivacyPool.sol's incremental tree, so
// the witness matches an on-chain state with exactly one deposit.
async function main() {
  // circomlibjs: buildPoseidonOpt returns { F, toString, ... } — the field's
  // toString converts a Montgomery-form field element to a decimal BigInt string.
  const P = await circomlibjs.buildPoseidonOpt();
  const hash2 = (a, b) => BigInt(P.F.toString(P([a, b])));
  const hash1 = (a) => BigInt(P.F.toString(P([a])));
  const dir = "build/withdraw_js";
  // 1. Private values.
  const nullifier = BigInt(1);
  const secret = BigInt(2);
  const commitment = hash2(nullifier, secret);

  // 2. Zero-hash chain: zeroHash[0]=0, zeroHash[k]=Poseidon(zeroHash[k-1],zeroHash[k-1]).
  const zeroHash = [BigInt(0)];
  for (let i = 1; i <= MERKLE_DEPTH; i++) {
    zeroHash.push(hash2(zeroHash[i - 1], zeroHash[i - 1]));
  }

  // 3. Single-leaf tree at index 0: leaf is always the LEFT child, sibling is
  //    always zeroHash[k]. Walk up to compute the root + path.
  let current = commitment;
  const pathElements = [];
  const pathIndices = [];
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    pathElements.push(zeroHash[i]);
    pathIndices.push(BigInt(0)); // leaf on the left every level
    current = hash2(current, zeroHash[i]);
  }
  const root = current;
  const nullifierHash = hash1(nullifier);

  const input = {
    root: root.toString(),
    recipient: "123",
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    merklePathElements: pathElements.map((x) => x.toString()),
    merklePathIndices: pathIndices.map((x) => x.toString()),
  };

  console.log("commitment   :", commitment.toString());
  console.log("root         :", root.toString());
  console.log("nullifierHash:", nullifierHash.toString());

  fs.writeFileSync("build/input.json", JSON.stringify(input, null, 2));

  // 4. Powers of Tau + Groth16 setup (self-run ceremony for the smoke test).
  //    snarkjs 0.7.x JS API: newAccumulator needs a curve object from
  //    getCurveFromName; everything else takes plain filenames.
  if (!fs.existsSync("build/pot_final.ptau")) {
    console.log("running powers of tau ceremony (smoke)...");
    const curve = await snarkjs.curves.getCurveFromName("bn128");
    await snarkjs.powersOfTau.newAccumulator(curve, 14, "build/pot_0000.ptau");
    await snarkjs.powersOfTau.contribute(
      "build/pot_0000.ptau",
      "build/pot_0001.ptau",
      "smoke-contribution",
      "UPL-P3.1-smoke-entropy"
    );
    await snarkjs.powersOfTau.preparePhase2(
      "build/pot_0001.ptau",
      "build/pot_final.ptau"
    );
  }

  // 5. Groth16 phase-2. zKey.newZKey(r1cs, ptau, zkeyOut) writes the phase-2
  //    start zkey; then one mandatory contribution finalizes it.
  if (!fs.existsSync("build/withdraw_final.zkey")) {
    console.log("groth16 newZKey + contribution...");
    await snarkjs.zKey.newZKey(
      "build/withdraw.r1cs",
      "build/pot_final.ptau",
      "build/withdraw_0000.zkey"
    );
    await snarkjs.zKey.contribute(
      "build/withdraw_0000.zkey",
      "build/withdraw_final.zkey",
      "phase2-contribution",
      "UPL-P3.1-phase2-entropy"
    );
  }

  // 6. Export verification key. snarkjs calls logger.info, so pass a console logger.
  const logger = { info: (m) => console.log(m), error: (m) => console.error(m), debug: () => {} };
  if (!fs.existsSync("build/verification_key.json")) {
    const vk = await snarkjs.zKey.exportVerificationKey(
      "build/withdraw_final.zkey",
      logger
    );
    fs.writeFileSync("build/verification_key.json", JSON.stringify(vk, null, 2));
  }

  // 7. fullProve: wasm witness + zkey -> proof + public signals.
  console.log("generating proof...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${dir}/withdraw.wasm`,
    "build/withdraw_final.zkey"
  );

  // 8. circom lays out public signals as: OUTPUTS first, then PUBLIC INPUTS.
  //    Here: [0]=nullifierHash (output), [1]=root (public input), [2]=recipient.
  console.log("public nullifierHash:", publicSignals[0]);
  console.log("public root         :", publicSignals[1]);
  console.log("public recipient    :", publicSignals[2]);
  if (publicSignals[0] !== nullifierHash.toString()) {
    throw new Error(
      `nullifierHash mismatch: got ${publicSignals[0]} expected ${nullifierHash}`
    );
  }
  if (publicSignals[1] !== root.toString()) {
    throw new Error(
      `root mismatch: got ${publicSignals[1]} expected ${root}`
    );
  }

  // 9. Verify the proof against the verification key.
  const vkey = JSON.parse(fs.readFileSync("build/verification_key.json"));
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log("verify:", ok ? "OK!" : "FAILED");
  if (!ok) process.exit(1);

  // 10. Negative control: tamper the nullifierHash (index 0) -> must FAIL.
  const tampered = [...publicSignals];
  tampered[0] = (BigInt(tampered[0]) + BigInt(1)).toString();
  const badOk = await snarkjs.groth16.verify(vkey, tampered, proof);
  console.log("tampered-verify:", badOk ? "OK (BAD!)" : "FAILED (correct)");
  if (badOk) {
    throw new Error("tampered proof verified — circuit is unsound!");
  }
  console.log("\nGATE PASSED: circuit is sound + satisfiable + verifies.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
