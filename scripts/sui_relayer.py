#!/usr/bin/env python3
"""
UPL Sui Relayer Service (P2.8 + Sui-parity follow-up)

Two modes:
  - announce  : submit a stealth-address announcement to the registry (no value).
  - relay-send: a REAL private send — announce + index + advance-cursor +
                relay a `Coin<SUI>` (value transfer) + mint an encrypted receipt,
                atomically via `stealth_transfer::relayed_send_entry` (package v4).

The relayed path is the Sui analog of the EVM relayer's "relay() + announce()"
pair, but atomic in one PTB. It needs the RelayerCap + ReceiptCap (held by the
relayer operator) + the shared RelayerState / Registry / ViewTagIndex /
AnnouncementIndexer objects, all read from deployed_sui_mainnet.json.

Usage:
  # One-shot test announce (P2.8 behavior, unchanged):
  python scripts/sui_relayer.py --test

  # Submit a specific announce:
  python scripts/sui_relayer.py --ephemeral-key 0x... --view-tag 42 --stealth-hash 0x...

  # Real relayed private send (split a gas coin for `amount_mist` and relay it):
  python scripts/sui_relayer.py relay-send \
      --recipient 0xRECIPIENT --amount-mist 10000 \
      --ephemeral-key 0x... --view-tag 42 --stealth-hash 0x... \
      --ciphertext 0x... --nonce 0x...
  # (omit --ciphertext/--nonce to auto-generate a placeholder pair for testing)

Required env (read from contracts/.env or environment):
  SUI_BIN  — path to the sui CLI binary (default: sui)

The relayer wallet (active `sui client` address) must own the RelayerCap +
ReceiptCap and have enough SUI to cover `amount_mist` + gas.
"""

import argparse
import base64
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
CLOCK_ID = "0x6"  # Sui shared Clock object


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


def run_sui(args, json_output=True, timeout=180):
    """Run the sui CLI with the given args, return parsed JSON or raw output."""
    sui_bin = os.environ.get("SUI_BIN", "sui")
    cmd = [sui_bin] + args
    if json_output:
        cmd.append("--json")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
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


def get_relayer_total(manifest):
    """Read total_relayed (net SUI ever forwarded) from the shared RelayerState."""
    state_id = manifest["shared_objects"].get("relayer_state")
    if not state_id:
        return None
    obj = run_sui(["client", "object", state_id])
    data = obj.get("data", obj)
    fields = data.get("content", {}).get("fields", {})
    return int(fields.get("total_relayed", 0))


def _b64(hex_or_bytes):
    """Accept 0x-hex or raw bytes; return base64 (what the Sui CLI wants for
    vector<u8> args on `client call`)."""
    if isinstance(hex_or_bytes, str):
        b = bytes.fromhex(hex_or_bytes.replace("0x", ""))
    else:
        b = hex_or_bytes
    return base64.b64encode(b).decode()


def submit_announce(manifest, ephemeral_pub_key_hex, view_tag_int, stealth_hash_hex):
    """Submit an announce_entry() transaction to the Sui mainnet registry.

    Uses `announce_entry` (package v3+) — a `public entry` function with ctx
    as the last param, so the Sui CLI auto-injects it and we pass 5 args:
    registry, ephemeral_pub_key, view_tag, stealth_hash, clock.
    """
    package_id = manifest["package_id"]
    registry_id = manifest["shared_objects"]["registry"]

    ephemeral_b64 = _b64(ephemeral_pub_key_hex)
    view_tag_b64 = _b64(bytes([view_tag_int & 0xFF]))
    stealth_b64 = _b64(stealth_hash_hex)

    log(f"Submitting announce() to Sui mainnet...")
    log(f"  package: {package_id}")
    log(f"  registry: {registry_id}")
    log(f"  view_tag: {view_tag_int}")

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


def _first_gas_coin_id():
    """Return the object id of the active address's first gas coin (used as the
    coin to split for the relay payment)."""
    obj = run_sui(["client", "gas"], json_output=True)
    # `sui client gas --json` returns a list of gas coin objects with `id`/`value`.
    if isinstance(obj, list) and obj:
        first = obj[0]
        return first.get("id") or first.get("gasCoinId") or first.get("objectId")
    # Fallback: parse the table form by listing owned objects of Coin<SUI> type.
    raise RuntimeError("Could not determine a gas coin id to split for the relay")


def relay_send(manifest, recipient, amount_mist, ephemeral_key_hex, view_tag_int,
               stealth_hash_hex, ciphertext_hex=None, nonce_hex=None):
    """A REAL private send on Sui mainnet: announce + index + advance-cursor +
    relay a `Coin<SUI>` of `amount_mist` to `recipient` + mint an encrypted
    receipt — atomically via `stealth_transfer::relayed_send_entry` (package v4).

    Steps:
      1. Split a gas coin to mint a `Coin<SUI>` worth exactly `amount_mist`.
      2. Call `relayed_send_entry` with that coin as `payment` (the CLI accepts
         base64 for the vector<u8> args; objects by id; view_tag as a u8 int).

    The relayer wallet (active address) must own RelayerCap + ReceiptCap.
    """
    so = manifest["shared_objects"]
    oc = manifest["owned_capabilities"]
    pkg = manifest["package_id"]

    required = ["relayer_state", "registry", "view_tag_index", "announcement_indexer"]
    missing = [k for k in required if not so.get(k)]
    if missing:
        raise RuntimeError(f"Manifest missing shared_objects: {missing}")

    # Resolve caps. Accept both the reconciled nested shape and a flat shape.
    def _cap(module, key):
        v = oc.get(module, {})
        if isinstance(v, dict):
            return v.get(key)
        # flat fallback: e.g. oc["relayer_cap"]
        return oc.get(key)

    relayer_cap = _cap("privacy_relayer", "relayer_cap") or oc.get("relayer_cap")
    receipt_cap = _cap("privacy_receipt", "receipt_cap") or oc.get("receipt_cap")
    if not relayer_cap or not receipt_cap:
        raise RuntimeError("Manifest missing relayer_cap / receipt_cap owned capabilities")

    if amount_mist <= 0:
        raise RuntimeError("amount_mist must be > 0 (relayed_send guards amount > 0)")
    if not (recipient or "").startswith("0x") or len(recipient) < 10:
        raise RuntimeError("recipient must be a 0x-prefixed Sui address")

    # Auto-generate a placeholder ciphertext/nonce pair if not supplied (for
    # testing; production callers supply a real ECDH-derived ciphertext).
    if ciphertext_hex is None:
        ciphertext_hex = "0x" + secrets.token_bytes(32).hex()
    if nonce_hex is None:
        nonce_hex = "0x" + secrets.token_bytes(12).hex()

    # 1. Split a gas coin into a payment coin worth amount_mist.
    gas_coin = _first_gas_coin_id()
    log(f"Splitting {amount_mist} MIST off gas coin {gas_coin} for the relay payment...")
    split = run_sui(["client", "split-coin",
                     "--coin-id", gas_coin,
                     "--amounts", str(amount_mist)], json_output=True, timeout=120)
    # `split-coin` creates N new coins; the LAST created Coin<SUI> is the split.
    payment_id = None
    for ch in (split.get("objectChanges") or split.get("effects", {}).get("created") or []):
        if ch.get("type") in ("created",) and "Coin<" in ch.get("objectType", ""):
            payment_id = ch.get("objectId")
    if not payment_id and isinstance(split, dict):
        # some CLI versions surface a flat list of created object ids
        created = split.get("created") or []
        for ch in created:
            if "Coin<" in str(ch.get("objectType", "")):
                payment_id = ch.get("objectId")
    if not payment_id:
        raise RuntimeError(f"Could not find the split payment coin in split-coin output: {str(split)[:300]}")
    log(f"  payment coin: {payment_id}")

    # 2. Call relayed_send_entry. Args (14, ctx auto-injected as the 15th):
    #    relayer_cap, receipt_cap, relayer_state, registry, vti, indexer,
    #    recipient, payment, ephemeral_key, view_tag(u8), stealth_hash,
    #    ciphertext, nonce, clock
    ephemeral_b64 = _b64(ephemeral_key_hex)
    stealth_b64 = _b64(stealth_hash_hex)
    ct_b64 = _b64(ciphertext_hex)
    nonce_b64 = _b64(nonce_hex)

    log(f"Calling relayed_send_entry on package {pkg}...")
    log(f"  recipient: {recipient}")
    log(f"  amount: {amount_mist} MIST")
    log(f"  view_tag: {view_tag_int}")

    result = run_sui([
        "client", "call",
        "--package", pkg,
        "--module", "stealth_transfer",
        "--function", "relayed_send_entry",
        "--args", relayer_cap, receipt_cap,
                 so["relayer_state"], so["registry"], so["view_tag_index"], so["announcement_indexer"],
                 recipient, payment_id,
                 ephemeral_b64, str(view_tag_int & 0xFF), stealth_b64, ct_b64, nonce_b64,
                 CLOCK_ID,
        "--gas-budget", "100000000",
    ], json_output=True, timeout=180)

    digest = result.get("digest", "unknown")
    effects = result.get("effects", {})
    status = effects.get("status", {}).get("status", "unknown")
    log(f"relayed_send tx submitted: {digest}")
    log(f"  status: {status}")

    # Confirm the on-chain side effects (registry grew, total_relayed advanced).
    count = get_registry_count(manifest)
    total = get_relayer_total(manifest)
    log(f"Registry announcement count: {count}")
    log(f"RelayerState total_relayed: {total}")

    return {
        "status": "relayed",
        "tx_digest": digest,
        "execution_status": status,
        "amount_mist": amount_mist,
        "recipient": recipient,
        "announcement_count": count,
        "total_relayed": total,
        "package_id": pkg,
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
    parser = argparse.ArgumentParser(description="UPL Sui Relayer Service (P2.8 + Sui-parity)")
    parser.add_argument("--test", action="store_true", help="Run a one-shot test announce")
    parser.add_argument("--ephemeral-key", type=str, help="Ephemeral public key (hex)")
    parser.add_argument("--view-tag", type=int, help="View tag (0-255)")
    parser.add_argument("--stealth-hash", type=str, help="Stealth hash (hex)")
    # relay-send subcommand
    sub = parser.add_subparsers(dest="command")
    rs = sub.add_parser("relay-send", help="Real relayed private send with Coin<SUI> value transfer")
    rs.add_argument("--recipient", required=True, help="Recipient Sui address (0x...)")
    rs.add_argument("--amount-mist", type=int, required=True, help="Amount to relay in MIST (1 SUI = 1e9 MIST)")
    rs.add_argument("--ephemeral-key", required=True, help="Ephemeral public key (0x-hex)")
    rs.add_argument("--view-tag", type=int, required=True, help="View tag (0-255)")
    rs.add_argument("--stealth-hash", required=True, help="Stealth hash (0x-hex)")
    rs.add_argument("--ciphertext", help="Encrypted receipt ciphertext (0x-hex); auto-generated if omitted")
    rs.add_argument("--nonce", help="Encryption nonce (0x-hex); auto-generated if omitted")
    args = parser.parse_args()

    load_env()
    manifest = load_manifest()

    log(f"Package ID: {manifest['package_id']}")
    log(f"Registry: {manifest['shared_objects']['registry']}")
    log(f"Network: {manifest['network']}")

    if args.command == "relay-send":
        result = relay_send(
            manifest,
            recipient=args.recipient,
            amount_mist=args.amount_mist,
            ephemeral_key_hex=args.ephemeral_key,
            view_tag_int=args.view_tag,
            stealth_hash_hex=args.stealth_hash,
            ciphertext_hex=args.ciphertext,
            nonce_hex=args.nonce,
        )
        print(json.dumps(result, indent=2))
    elif args.test:
        result = run_test(manifest)
        print(json.dumps(result, indent=2))
    elif args.ephemeral_key and args.view_tag is not None and args.stealth_hash:
        result = submit_announce(manifest, args.ephemeral_key, args.view_tag, args.stealth_hash)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
