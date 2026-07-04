"""
E2E demo — DEPOSIT step only — using the deployer key.

Sends a real PrivacyPool.deposit(commitment) to the live Base mainnet
contract, polls for the receipt, decodes the Deposit event, fetches
the new root, and prints a summary.

Uses cast via PATH. Does NOT generate the snarkjs proof here — this
is the deposit half of the e2e test (Phase 3.5 backend rebuilds the
tree from DB; Phase 3.6 frontend generates the proof).
"""

import json
import os
import random
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

# ── trace values from the P3.4 broadcast (verified live) ──
PRIVACY_POOL = "0x3A7DA29bfd9853A0449c8c51F7007B7f5126C455"
DEPLOYER     = "0x3f44A6451439673D95082A1337045a25ec275394"
DENOMINATION = 100_000_000_000_000_000  # 0.1 ETH
RPC = "https://mainnet.base.org"


def load_deployer_key() -> str:
    env = REPO / "contracts" / ".env"
    with open(env) as f:
        for line in f:
            line = line.strip().strip('"')
            if line.startswith("DEPLOYER_PRIVATE_KEY="):
                return line.split("=", 1)[1].strip().strip("'")
    raise RuntimeError("DEPLOYER_PRIVATE_KEY not found")


def field_element() -> int:
    return random.randrange(1, 2**248)


def main() -> int:
    # ── 1. compute commitment using the deployed PoseidonT3-equivalent ──
    from zk_merkle import compute_commitment as poseidon2
    nullifier = field_element()
    secret    = field_element()
    commitment_int = poseidon2(nullifier, secret)
    commitment_hex = "0x" + hex(commitment_int)[2:].rjust(64, "0")
    print(f"\u2500" * 70)
    print(f"[1/5] generated note + commitment")
    print(f"  nullifier            : {nullifier:#066x}")
    print(f"  secret               : {secret:#066x}")
    print(f"  commitment (int)     : {commitment_int}")
    print(f"  commitment (0x prev) : {commitment_hex}")

    # ── 2. balance pre-state ──
    bal_pre = float(subprocess.run(
        ["cast", "balance", DEPLOYER, "--rpc-url", RPC, "--ether"],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip().split()[0].replace("ether", "").strip())
    nli_pre = int(subprocess.run(
        ["cast", "call", PRIVACY_POOL, "nextLeafIndex()(uint256)", "--rpc-url", RPC],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip())
    root_pre = subprocess.run(
        ["cast", "call", PRIVACY_POOL, "currentRoot()(uint256)", "--rpc-url", RPC],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    print(f"\u2500" * 70)
    print(f"[pre-state] deployer ETH balance: {bal_pre} ETH")
    print(f"[pre-state] nextLeafIndex: {nli_pre}  currentRoot: {root_pre}")

    # ── 3. send deposit tx ──
    pk = load_deployer_key()
    env = os.environ.copy()
    env["CAST_PRIVATE_KEY"] = pk[2:]  # strip 0x
    r = subprocess.run(
        ["cast", "send", "--rpc-url", RPC, "--private-key", pk[2:],
         PRIVACY_POOL, "deposit(uint256)", commitment_hex,
         "--value", str(DENOMINATION), "--gas-limit", "200000"],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        print("cast send FAILED:")
        print("STDOUT:", r.stdout)
        print("STDERR:", r.stderr)
        return 1
    tx_hash = None
    for line in r.stdout.splitlines():
        if "transactionHash" in line:
            tx_hash = line.split(":")[1].strip()
            break
    print(f"\u2500" * 70)
    print(f"[3/5] deposit broadcasted")
    print(f"  tx_hash : {tx_hash}")
    print(f"  basescan: https://basescan.org/tx/{tx_hash}")

    # ── 4. receipt + parse Deposit event ──
    rcpt = json.loads(subprocess.run(
        ["cast", "receipt", tx_hash, "--rpc-url", RPC, "--json"],
        capture_output=True, text=True, timeout=60,
    ).stdout)
    print(f"\u2500" * 70)
    print(f"[4/5] receipt blockNumber={rcpt.get('blockNumber')} status={rcpt.get('status')} gasUsed={rcpt.get('gasUsed')}")
    # Find the Deposit event log. The PrivacyPool emit signature is
    #   Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)
    # The topic[0] is keccak("Deposit(uint256,uint32,uint256)").
    deposit_topic = "0x" + "5e5b8c1d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5e6f1f6a5b1c5d5"[2:]  # placeholder
    leaf_index = None
    for log in rcpt.get("logs", []):
        if log.get("address", "").lower() != PRIVACY_POOL.lower():
            continue
        topics = log.get("topics", [])
        if not topics:
            continue
        # Compute the event signature topic and compare
        sig_topic = subprocess.run(
            ["cast", "keccak", "Deposit(uint256,uint32,uint256)"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip().lower()
        if topics[0].lower() == sig_topic:
            data = log.get("data", "0x")[2:]
            # data is ABI-encoded (uint32 leafIndex, uint256 timestamp)
            leaf_index = int(data[:64], 16)
            commit_topic = topics[1]
            print(f"  Deposit event: leafIndex={leaf_index}  topic.commitment={commit_topic}")
            break
    if leaf_index is None:
        # fallback to nextLeafIndex - 1
        leaf_index = int(subprocess.run(
            ["cast", "call", PRIVACY_POOL, "nextLeafIndex()(uint256)", "--rpc-url", RPC],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()) - 1
        print(f"  (event topic not matched — fell back to nextLeafIndex-1 = {leaf_index})")

    # ── 5. post-state ──
    bal_post = float(subprocess.run(
        ["cast", "balance", DEPLOYER, "--rpc-url", RPC, "--ether"],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip().split()[0].replace("ether", "").strip())
    nli_post = int(subprocess.run(
        ["cast", "call", PRIVACY_POOL, "nextLeafIndex()(uint256)", "--rpc-url", RPC],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip())
    root_post = subprocess.run(
        ["cast", "call", PRIVACY_POOL, "currentRoot()(uint256)", "--rpc-url", RPC],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    print(f"\u2500" * 70)
    print(f"[5/5] post-state")
    print(f"  deployer balance:  {bal_pre} ETH -> {bal_post} ETH "
          f"(diff: {round(bal_post - bal_pre, 6)} ETH, gas consumed)")
    print(f"  nextLeafIndex:     {nli_pre} -> {nli_post}  ({'+1' if nli_post == nli_pre + 1 else '!!'})")
    print(f"  currentRoot:       {root_pre}\n                       -> {root_post}")
    print(f"  leafIndex of this deposit: {leaf_index}")
    print(f"\u2500" * 70)
    print(f"DEPOSIT E2E COMPLETE.")
    print(f"\u2500" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
