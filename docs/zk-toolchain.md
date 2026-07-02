# ZK Toolchain Setup (Phase 3)

The Universal Privacy Layer's ZK proving system (Phase 3 — privacy pool) is built
with **circom** (circuit compiler) + **snarkjs** (Powers of Tau ceremony, Groth16
proving/verification, Solidity verifier export).

> **Why WSL / Linux?** `circom` has no native Windows build. The entire ZK
> toolchain runs in **WSL (Ubuntu)**, consistent with the Solana toolchain. All
> commands below assume a WSL bash shell.

## Prerequisites (already installed in this environment)

- WSL Ubuntu, Node.js 20+, npm 10+, Rust/cargo (for circom from source if needed),
  `build-essential`, `libgmp` (circom's big-int backend).

## Install circom + snarkjs

```bash
# circom v2.2.2 (prebuilt Linux binary — fast, no compile)
curl -L -o /tmp/circom https://github.com/iden3/circom/releases/download/v2.2.2/circom-linux-amd64
chmod +x /tmp/circom
mkdir -p ~/.local/bin && mv /tmp/circom ~/.local/bin/circom
circom --version   # → circom compiler 2.2.2

# snarkjs v0.7.6 (global npm)
npm install -g snarkjs
snarkjs --version  # → snarkjs@0.7.6
```

Ensure `~/.local/bin` is on `PATH` (add to `~/.bashrc` if not):
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## circomlib

`circomlib` (the Poseidon / Merkle / comparator circuit library) is vendored as a
plain git checkout at `contracts/circuits/circomlib/` (not a submodule — it's
part of the repo so the circuit compiles without network access). To refresh:

```bash
cd contracts/circuits
rm -rf circomlib && git clone --depth 1 https://github.com/iden3/circomlib.git
```

## Directory layout

```
contracts/circuits/
├── circomlib/          # vendored circuit library (Poseidon, etc.)
├── withdraw.circom     # the privacy-pool withdrawal proof (P3.1)
└── build/              # gitignored — r1cs, wasm, zkey, ptau (large binaries)
```

Build artifacts (`.r1cs`, `.wasm`, `.zkey`, `.ptau`, `*_js/`) are large and/or
secret-derived — they are **gitignored** under `contracts/circuits/build/`. The
proving key (`.zkey`) and wasm witness generator are distributed via a release
artifact / CDN at frontend build time (P3.6), never committed.

## Verified working (P3.0 gate, 2026-07-02)

A Poseidon smoke circuit compiled to 243 non-linear constraints, then a full
Powers of Tau → Groth16 setup → proof generation → **verification returned
`OK!`**. The toolchain is proven end-to-end.

## Key versions

| Tool      | Version | Source                                   |
|-----------|---------|------------------------------------------|
| circom    | 2.2.2   | iden3/circom (prebuilt Linux amd64)      |
| snarkjs   | 0.7.6   | iden3/snarkjs (npm global)               |
| circomlib | 2.0.5   | iden3/circomlib (vendored checkout)      |
| curve     | bn128   | Groth16 proving curve                    |

## Common commands (used in P3.1–P3.2)

```bash
# Compile a circuit
circom withdraw.circom --r1cs --wasm --sym -l . -o build

# Powers of Tau ceremony (self-run) — see scripts/zk_powers_of_tau.sh
snarkjs powersoftau new bn128 14 pot_0000.ptau
snarkjs powersoftau contribute pot_0000.ptau pot_0001.ptau --name="..." -e="<entropy>"
snarkjs powersoftau prepare phase2 pot_0001.ptau pot_final.ptau

# Groth16 setup + phase-2 contribute
snarkjs groth16 setup build/withdraw.r1cs pot_final.ptau withdraw_0000.zkey
snarkjs zkey contribute withdraw_0000.zkey withdraw_final.zkey -e="<entropy>"

# Export verifier + keys
snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json
snarkjs zkey export solidityverifier withdraw_final.zkey Verifier.sol

# Generate + verify a proof (args: input wasm zkey proof public)
snarkjs groth16 fullprove input.json build/withdraw_js/withdraw.wasm \
    withdraw_final.zkey proof.json public.json
snarkjs groth16 verify verification_key.json public.json proof.json
```
