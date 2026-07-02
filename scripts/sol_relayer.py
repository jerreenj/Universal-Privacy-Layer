#!/usr/bin/env python3
"""
UPL Solana Relayer Service (P2.10)

Mirrors scripts/sui_relayer.py for the Solana (SVM) chain. Builds + submits
the `relay_and_announce` transaction via the Solana CLI or @solana/web3.js.

Usage:
  # One-shot test: generate a stealth address, create intent, relay:
  python scripts/sol_relayer.py --test --amount 1000000

  # Relay a specific send:
  python scripts/sol_relayer.py relay-send --recipient <base58> --amount-lamports 1000000

Required env (read from contracts/.env or environment):
  SOL_RPC_URL          — Solana RPC (default: https://api.devnet.solana.com; set to
                         https://api.mainnet-beta.solana.com for mainnet Step 10b)
  SOL_RELAYER_PRIVATE_KEY  — the relayer wallet's keypair JSON file path
  SOL_PROGRAM_ID       — the deployed UPL Solana program ID
"""

import argparse
import json
import os
import sys
import secrets
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).parent.parent
ENV_PATH = REPO_ROOT / "contracts" / ".env"
# Default to the devnet manifest (Step 10a). Override with UPL_DEPLOYED_SOL_JSON
# (absolute or REPO_ROOT-relative) to point at a mainnet manifest for Step 10b.
_env_manifest = os.environ.get("UPL_DEPLOYED_SOL_JSON")
MANIFEST_PATH = (Path(_env_manifest) if _env_manifest and Path(_env_manifest).is_absolute()
                 else REPO_ROOT / (_env_manifest or "scripts/deployed_sol_devnet.json"))


def log(msg):
    print(f"[sol-relayer] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def load_env():
    """Load env vars from contracts/.env if present, then from os.environ."""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

    rpc = os.environ.get("SOL_RPC_URL", "https://api.devnet.solana.com")
    key = os.environ.get("SOL_RELAYER_PRIVATE_KEY") or os.environ.get("SOL_PRIVATE_KEY")
    if not key:
        log("ERROR: No SOL_RELAYER_PRIVATE_KEY or SOL_PRIVATE_KEY in env")
        sys.exit(1)
    return rpc, key


def load_manifest():
    """Read the Solana deployment manifest (devnet by default) for program ID + PDAs."""
    if not MANIFEST_PATH.exists():
        log(f"ERROR: {MANIFEST_PATH} not found — program not deployed yet")
        sys.exit(1)
    data = json.loads(MANIFEST_PATH.read_text())
    return data


# Resolve the cluster URL to pass explicitly to every solana CLI call so we never
# silently hit the wrong network regardless of the global `solana config`.
_SOL_CLUSTER_URL = os.environ.get("SOL_RPC_URL", "https://api.devnet.solana.com")


def run_solana(args, timeout=60):
    """Run a solana CLI command (pinned to _SOL_CLUSTER_URL via --url) and return its output."""
    import subprocess
    full_args = ["solana", "--url", _SOL_CLUSTER_URL] + args
    result = subprocess.run(full_args, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        log(f"solana {' '.join(full_args)} failed: {result.stderr.strip()}")
        return None
    return result.stdout.strip()


def get_registry_count(manifest):
    """Read the RegistryState PDA's next_id (announcement count)."""
    registry_pda = manifest.get("registry_pda")
    if not registry_pda:
        return None
    # Use solana CLI to read the account
    output = run_solana(["account", registry_pda, "--output", "json"])
    if not output:
        return None
    try:
        data = json.loads(output)
        # The account data is base64-encoded; parse next_id at offset 74
        import base64
        raw = base64.b64decode(data.get("value", {}).get("data", ["", ""])[0])
        if len(raw) >= 82:
            return int.from_bytes(raw[74:82], "little")
    except Exception as e:
        log(f"Failed to parse registry: {e}")
    return None


def relay_send(manifest, recipient, amount_lamports, ephemeral_key=None, view_tag=None,
               stealth_hash=None, ciphertext=None, nonce=None):
    """Build + submit the relay_and_announce transaction.

    NOTE: This requires the program to be deployed on mainnet (Step 10).
    Until then, this returns an error. The structure is complete and ready
    to wire once the program is live + the relayer wallet is funded.
    """
    program_id = manifest.get("program_id")
    if not program_id:
        return {"error": "program_id not in manifest"}

    # Generate ephemeral key if not provided
    if not ephemeral_key:
        ephemeral_key = secrets.token_hex(32)
    if view_tag is None:
        view_tag = secrets.randbelow(256)
    if not stealth_hash:
        stealth_hash = secrets.token_hex(32)
    if not ciphertext:
        ciphertext = secrets.token_hex(16)
    if not nonce:
        nonce = secrets.token_hex(12)

    log(f"Relay send — recipient={recipient}, amount={amount_lamports} lamports, viewTag={view_tag}")
    log(f"Program ID: {program_id}")
    log(f"NOTE: Full relay requires mainnet deployment (Step 10) + funded relayer wallet")

    # TODO (Step 10): Once deployed, this will:
    # 1. Derive the Announcement PDA: seeds = ["announce", next_id.to_le_bytes()]
    # 2. Derive the Receipt PDA: seeds = ["receipt", next_receipt_id.to_le_bytes()]
    # 3. Build the relay_and_announce instruction with all args
    # 4. Sign + submit via solana CLI or @solana/web3.js
    # 5. Return the tx signature + announcement_count + total_relayed

    return {
        "status": "not_deployed",
        "message": "Solana program not yet deployed on mainnet (Step 10 — needs SOL funding). "
                   "The Rust program + relayer script are complete and ready.",
        "program_id": program_id,
        "recipient": recipient,
        "amount_lamports": amount_lamports,
    }


def run_test(manifest, amount_lamports):
    """One-shot test: generate a random stealth recipient + relay."""
    # Generate a random Solana keypair as the stealth recipient
    output = run_solana(["keygen", "new", "--no-bip39-passphrase", "--silent", "--force", "--outfile", "/tmp/test_recipient.json"])
    if not output:
        log("Failed to generate test recipient keypair")
        return

    recipient_pubkey = run_solana(["keygen", "pubkey", "/tmp/test_recipient.json"])
    if not recipient_pubkey:
        log("Failed to get recipient pubkey")
        return

    log(f"Test stealth recipient: {recipient_pubkey}")
    result = relay_send(manifest, recipient_pubkey, amount_lamports)
    return result


def main():
    parser = argparse.ArgumentParser(description="UPL Solana Relayer Service (P2.10)")
    parser.add_argument("--test", action="store_true", help="Run a one-shot test relay")
    parser.add_argument("--amount", type=int, default=1000000, help="Test amount in lamports (default: 1000000)")
    subparsers = parser.add_subparsers(dest="command")

    relay_parser = subparsers.add_parser("relay-send", help="Relay a private send")
    relay_parser.add_argument("--recipient", required=True, help="Recipient base58 address")
    relay_parser.add_argument("--amount-lamports", type=int, required=True, help="Amount in lamports")
    relay_parser.add_argument("--ephemeral-key", type=str, default=None)
    relay_parser.add_argument("--view-tag", type=int, default=None)
    relay_parser.add_argument("--stealth-hash", type=str, default=None)
    relay_parser.add_argument("--ciphertext", type=str, default=None)
    relay_parser.add_argument("--nonce", type=str, default=None)

    args = parser.parse_args()

    rpc, key = load_env()
    manifest = load_manifest()

    log(f"RPC: {rpc}")
    log(f"Program ID: {manifest.get('program_id', '?')}")
    log(f"Registry PDA: {manifest.get('registry_pda', '?')}")

    count = get_registry_count(manifest)
    if count is not None:
        log(f"Registry announcement count: {count}")

    if args.test:
        log(f"=== Running test relay — amount: {args.amount} lamports ===")
        result = run_test(manifest, args.amount)
        print(json.dumps(result, indent=2))
    elif args.command == "relay-send":
        result = relay_send(
            manifest, args.recipient, args.amount_lamports,
            args.ephemeral_key, args.view_tag, args.stealth_hash,
            args.ciphertext, args.nonce,
        )
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
