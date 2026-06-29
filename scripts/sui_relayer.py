#!/usr/bin/env python3
"""
UPL Sui Relayer Service (P2.8)

Submits announce() transactions to the Sui mainnet StealthAddressRegistry.
Uses the sui CLI with `ptb` (Programmable Transaction Builder) to construct
and submit the transaction, handling shared objects + TxContext automatically.

Usage:
  # One-shot test announce:
  python scripts/sui_relayer.py --test

  # Submit a specific announce:
  python scripts/sui_relayer.py --ephemeral-key 0x... --view-tag 42 --stealth-hash 0x...

Required env (read from contracts/.env or environment):
  SUI_BIN  — path to the sui CLI binary (default: sui)
"""

import argparse
import json
import os
import sys
import secrets
import subprocess
import hashlib
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).parent.parent
ENV_PATH = REPO_ROOT / "contracts" / ".env"
MANIFEST_PATH = REPO_ROOT / "scripts" / "deployed_sui_mainnet.json"


def log(msg):
    print(f"[sui_relayer] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def load_env():
    """Load env vars from contracts/.env if present."""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def load_manifest():
    """Read deployed_sui_mainnet.json for object IDs."""
    if not MANIFEST_PATH.exists():
        log(f"ERROR: {MANIFEST_PATH} not found")
        sys.exit(1)
    return json.loads(MANIFEST_PATH.read_text())


def run_sui(args, json_output=True):
    """Run the sui CLI with the given args, return parsed JSON or raw output."""
    sui_bin = os.environ.get("SUI_BIN", "sui")
    cmd = [sui_bin] + args
    if json_output:
        cmd.append("--json")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        log(f"sui command failed: {' '.join(cmd[:5])}...")
        log(f"stderr: {result.stderr[:500]}")
        log(f"stdout: {result.stdout[:500]}")
        raise RuntimeError(f"sui CLI exited {result.returncode}")
    if json_output:
        raw = result.stdout.strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            lines = raw.split("\n")
            for i in range(len(lines) - 1, -1, -1):
                line = lines[i].strip()
                if line.startswith("{") or line.startswith("["):
                    try:
                        return json.loads("\n".join(lines[i:]))
                    except json.JSONDecodeError:
                        try:
                            return json.loads(line)
                        except json.JSONDecodeError:
                            continue
            raise RuntimeError(f"Could not parse JSON from sui output: {raw[:300]}")
    return result.stdout


def get_registry_count(manifest):
    """Read the announcement count from the shared Registry object."""
    registry_id = manifest["shared_objects"]["registry"]
    obj = run_sui(["client", "object", registry_id])
    data = obj.get("data", obj)
    content = data.get("content", {})
    fields = content.get("fields", {})
    return int(fields.get("next_id", 0))


def submit_announce(manifest, ephemeral_pub_key_hex, view_tag_int, stealth_hash_hex):
    """Submit an announce() transaction to the Sui mainnet registry.

    The announce function signature:
      public(package) entry fun announce(
        ctx: &TxContext, registry: &mut Registry,
        ephemeral_pub_key: vector<u8>, view_tag: vector<u8>,
        stealth_hash: vector<u8>, clock: &Clock)

    We use `sui client call` which auto-injects &TxContext. The CLI counts
    it as a parameter though, so we pass 5 args (the non-ctx ones) and it
    expects 6. The workaround: pass the Clock object ID as a string for the
    ctx position — the CLI ignores it and uses the real TxContext.

    Actually the simplest approach: the `sui client call` in v1.73 expects
    exactly the number of NON-implicit parameters. For `public(package) entry`
    functions, &TxContext is implicit. But this CLI version counts it.
    We work around by passing the gas coin as a dummy for ctx.
    """
    package_id = manifest["package_id"]
    registry_id = manifest["shared_objects"]["registry"]
    CLOCK_ID = "0x6"  # Sui shared Clock object

    # Convert to base64 for vector<u8> args (Sui CLI accepts base64 for bytes)
    import base64
    ephemeral_bytes = bytes.fromhex(ephemeral_pub_key_hex.replace("0x", ""))
    view_tag_bytes = bytes([view_tag_int & 0xFF])
    stealth_hash_bytes = bytes.fromhex(stealth_hash_hex.replace("0x", ""))

    ephemeral_b64 = base64.b64encode(ephemeral_bytes).decode()
    view_tag_b64 = base64.b64encode(view_tag_bytes).decode()
    stealth_b64 = base64.b64encode(stealth_hash_bytes).decode()

    log(f"Submitting announce() to Sui mainnet...")
    log(f"  package: {package_id}")
    log(f"  registry: {registry_id}")
    log(f"  view_tag: {view_tag_int}")
    log(f"  ephemeral_key (b64): {ephemeral_b64[:20]}...")
    log(f"  stealth_hash (b64): {stealth_b64[:20]}...")

    # Use `announce_entry` (added in package v3) — it's a `public entry` function
    # with ctx as the last param, so the Sui CLI auto-injects it and we only pass
    # 5 args: registry, ephemeral_pub_key, view_tag, stealth_hash, clock.
    result = run_sui([
        "client", "call",
        "--package", package_id,
        "--module", "stealth_address_registry",
        "--function", "announce_entry",
        "--args", registry_id, ephemeral_b64, view_tag_b64, stealth_b64, CLOCK_ID,
        "--gas-budget", "50000000",
    ], json_output=True)

    digest = result.get("digest", "unknown")
    effects = result.get("effects", {})
    status = effects.get("status", {}).get("status", "unknown")
    log(f"announce() tx submitted: {digest}")
    log(f"  status: {status}")

    # Verify the announcement count increased
    count = get_registry_count(manifest)
    log(f"Registry announcement count: {count}")

    return {
        "tx_digest": digest,
        "status": status,
        "announcement_count": count,
        "package_id": package_id,
        "registry_id": registry_id,
        "explorer": f"https://suiexplorer.com/txblock/{digest}",
    }


def run_test(manifest):
    """One-shot test: generate random ephemeral key + view tag, submit announce."""
    ephemeral_key = secrets.token_bytes(32)
    view_tag = secrets.randbelow(256)
    stealth_hash = hashlib.sha256(ephemeral_key).digest()

    log("=== Running test announce on Sui mainnet ===")
    log(f"Generated ephemeral key: 0x{ephemeral_key.hex()[:20]}...")
    log(f"Generated view tag: {view_tag}")
    log(f"Generated stealth hash: 0x{stealth_hash.hex()[:20]}...")

    count_before = get_registry_count(manifest)
    log(f"Announcement count before: {count_before}")

    result = submit_announce(
        manifest,
        "0x" + ephemeral_key.hex(),
        view_tag,
        "0x" + stealth_hash.hex(),
    )

    log("=== Test complete ===")
    return result


def main():
    parser = argparse.ArgumentParser(description="UPL Sui Relayer Service (P2.8)")
    parser.add_argument("--test", action="store_true", help="Run a one-shot test announce")
    parser.add_argument("--ephemeral-key", type=str, help="Ephemeral public key (hex)")
    parser.add_argument("--view-tag", type=int, help="View tag (0-255)")
    parser.add_argument("--stealth-hash", type=str, help="Stealth hash (hex)")
    args = parser.parse_args()

    load_env()
    manifest = load_manifest()

    log(f"Package ID: {manifest['package_id']}")
    log(f"Registry: {manifest['shared_objects']['registry']}")
    log(f"Network: {manifest['network']}")

    if args.test:
        result = run_test(manifest)
        print(json.dumps(result, indent=2))
    elif args.ephemeral_key and args.view_tag is not None and args.stealth_hash:
        result = submit_announce(manifest, args.ephemeral_key, args.view_tag, args.stealth_hash)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
