// Reference implementation of circomlib's OPTIMIZED Poseidon (the exact
// structure in poseidon.circom) over the BN254 scalar field, using constants
// extracted from the vendored poseidon_constants.circom. Confirms our
// understanding reproduces the known circuit hash BEFORE porting to Solidity.
//
//   node scripts/verify_poseidon_ref.js <circuits_dir>
//
// Known vector (withdraw.circom compiled + circomlibjs):
//   poseidon(1, 2) = 7853200120776062878684798364095072458815029376092732009249414926327459813530
const fs = require("fs");
const path = require("path");

const circuitsDir = process.argv[2];
const Q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
const mod = (a, b = Q) => ((a % b) + b) % b;

// Extract constants by scanning the file with a regex that tracks the current
// function, then grouping branch markers PER FUNCTION. (A global flat list
// mis-attributes branches across function boundaries.)
function extractAll() {
  const consts = fs.readFileSync(path.join(circuitsDir, "circomlib/circuits/poseidon_constants.circom"), "utf8");
  const re = /function\s+(\w+)\s*\(\s*t\s*\)|(\b(?:if|else if)\b)\s*\(\s*t==(\d+)\s*\)/g;
  const byFn = {};
  let m, curFn = null;
  const order = [];
  while ((m = re.exec(consts)) !== null) {
    if (m[1]) { curFn = m[1]; if (!byFn[curFn]) { byFn[curFn] = []; order.push(curFn); } continue; }
    byFn[curFn].push({ t: Number(m[3]), s: m.index });
  }
  const out = {};
  for (const fn of order) {
    const arr = byFn[fn];
    out[fn] = {};
    for (let i = 0; i < arr.length; i++) {
      const end = i + 1 < arr.length ? arr[i + 1].s : consts.length;
      const body = consts.slice(arr[i].s, end);
      // Match hex literals directly — robust to flat (C[]) and nested (M[]/P[]) layouts.
      const vals = (body.match(/0x[0-9a-fA-F]+/g) || []).map(BigInt);
      out[fn][arr[i].t] = vals;
    }
  }
  return out;
}

const ALL = extractAll();
const get = (name, t) => {
  const v = ALL[name] && ALL[name][t];
  if (!v) throw new Error(`${name}(${t}) not found`);
  return v;
};

const t = 3;
const nRoundsF = 8;
const nRoundsP = 57; // N_ROUNDS_P[t-2] from poseidon.circom
const C = get("POSEIDON_C", t);    // length t*nRoundsF + nRoundsP = 81
const Mflat = get("POSEIDON_M", t); // t*t = 9, row-major
const Pflat = get("POSEIDON_P", t); // t*t = 9
const S = get("POSEIDON_S", t);     // nRoundsP*(2t-1) = 285
const M = [], P = [];
for (let i = 0; i < t; i++) { M.push(Mflat.slice(i * t, (i + 1) * t)); P.push(Pflat.slice(i * t, (i + 1) * t)); }
console.error(`C=${C.length} M=${M.length}x${t} P=${P.length}x${t} S=${S.length}`);
if (C.length !== t * nRoundsF + nRoundsP) throw new Error(`C len ${C.length} != ${t * nRoundsF + nRoundsP}`);
if (S.length !== nRoundsP * (2 * t - 1)) throw new Error(`S len ${S.length} != ${nRoundsP * (2 * t - 1)}`);

const sigma = (x) => { const x2 = mod(x * x); return mod(x2 * x2 * x); };
// circomlib Mix: out[i] = sum_j M[j][i] * in[j]   (column index is the output).
function mixFull(state, matrix) {
  const out = new Array(t);
  for (let i = 0; i < t; i++) {
    let acc = 0n;
    for (let j = 0; j < t; j++) acc = mod(acc + matrix[j][i] * state[j]);
    out[i] = acc;
  }
  return out;
}
// circomlib MixS (sparse mix, round r): out[0] = dot(S[r*(2t-1)+0..t-1], in);
// out[i>0] = in[i] + S[r*(2t-1)+(t-1)+i] * in[0]. (Matches MixS template.)
function mixS(state, r) {
  const base = r * (2 * t - 1);
  const out = new Array(t);
  let acc = 0n;
  for (let i = 0; i < t; i++) acc = mod(acc + S[base + i] * state[i]);
  out[0] = acc;
  for (let i = 1; i < t; i++) out[i] = mod(state[i] + S[base + (t - 1) + i] * state[0]);
  return out;
}

function poseidon2(a, b) {
  // PoseidonEx line 92-99: ark[0].in[0] = initialState (=0), in[j>0] = inputs[j-1].
  // So for poseidon(a,b): state = [initialState=0, a, b], NOT [a, b, 0].
  let st = [0n, a, b];
  // ark[0]: add C[0..t-1]
  st = st.map((v, i) => mod(v + C[i]));
  // first nRoundsF/2 - 1 full rounds (sigma all, ark offset (r+1)*t, mix M)
  for (let r = 0; r < nRoundsF / 2 - 1; r++) {
    st = st.map(sigma);
    st = st.map((v, i) => mod(v + C[(r + 1) * t + i]));
    st = mixFull(st, M);
  }
  // the (nRoundsF/2)-th full round, mixed with P
  st = st.map(sigma);
  st = st.map((v, i) => mod(v + C[(nRoundsF / 2) * t + i]));
  st = mixFull(st, P);
  // partial rounds: sigma element0, +C[(nRoundsF/2+1)*t + r] into element0, then mixS
  for (let r = 0; r < nRoundsP; r++) {
    st[0] = sigma(st[0]);
    st[0] = mod(st[0] + C[(nRoundsF / 2 + 1) * t + r]);
    st = mixS(st, r);
  }
  // last nRoundsF/2 - 1 full rounds (sigma all, ark offset (nRoundsF/2+1)*t + nRoundsP + r*t, mix M)
  for (let r = 0; r < nRoundsF / 2 - 1; r++) {
    st = st.map(sigma);
    st = st.map((v, i) => mod(v + C[(nRoundsF / 2 + 1) * t + nRoundsP + r * t + i]));
    st = mixFull(st, M);
  }
  // final sigma all + mixLast[0] (dot with M column 0)
  st = st.map(sigma);
  let acc = 0n;
  for (let j = 0; j < t; j++) acc = mod(acc + M[j][0] * st[j]);
  return acc;
}

const cases = [
  [0n, 0n, 14744269619966411208579211824598458697587494354926760081771325075741142829156n],
  [1n, 0n, 18423194802802147121294641945063302532319431080857859605204660473644265519999n],
  [1n, 2n, 7853200120776062878684798364095072458815029376092732009249414926327459813530n],
];
let allOk = true;
for (const [a, b, want] of cases) {
  const got = poseidon2(a, b);
  const ok = got === want;
  allOk = allOk && ok;
  console.log(`poseidon(${a},${b}) = ${got.toString()}${ok ? "" : "\n  expected    = " + want.toString()}`);
  console.log(ok ? "  ✅" : "  ❌ MISMATCH");
}
console.log(allOk ? "\nMATCH ✅ — algorithm + constants verified" : "\nMISMATCH ❌");
process.exit(allOk ? 0 : 1);
