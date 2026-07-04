#!/usr/bin/env python3
"""
P3.4-broadcast post-merge step.

Forge's vm.writeJson quirk only persists chainId on real broadcasts
(see the workarounds listed in contracts/deployed_base.json
'redeployNote'). The on-chain address is console-printed in the
broadcast but not written to the manifest by Forge.

This script reads the most-recent broadcast (broadcast/Deploy.s.sol/<chainId>/
run-latest.json) and merges the actual deployed contract addresses
into contracts/deployed_base.json. It also adds deployedAt + commit.

Works under both:
  - linux/mac python3 (path = "/Users/.../contracts/...")
  - git-bash on Windows (path = "/c/Users/.../contracts/...")
  - native Windows python (path = "C:\\Users\\...\\contracts\\...")

Exit code 0 on success, 1 on any malformed input (caller should
treat this as a hard error — the post-merge is a contract-deliverable
artifact, not a best-effort cleanup).
"""

from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
from pathlib import Path


def _resolve_path(p: str) -> Path:
    """Normalize a path string that may be in unix or Windows format."""
    if not p:
        raise ValueError("empty path")
    # Pure unix path: starts with '/' (including the git-bash form
    # /c/Users/...). We just expanduser + abs.
    s = os.path.expanduser(p)
    s = os.path.abspath(s)
    return Path(s)


def _read_forge_broadcast(broadcast_dir: Path, chain_id: int) -> dict:
    """Read the most recent broadcast JSON for this chainId."""
    chain_dir = broadcast_dir / str(chain_id)
    if not chain_dir.is_dir():
        raise FileNotFoundError(
            f"No broadcast directory for chainId={chain_id} at {chain_dir}"
        )

    # Prefer a fresh dry-run if --broadcast was actually used this
    # will live in a timestamped subdir; the dry-run/ subdir has the
    # last pre-broadcast simulation.
    candidates: list[Path] = []
    for sub in chain_dir.iterdir():
        if sub.is_dir() and sub.name != "dry-run":
            rl = sub / "run-latest.json"
            if rl.is_file():
                candidates.append(rl)
    if not candidates:
        rl = chain_dir / "dry-run" / "run-latest.json"
        if rl.is_file():
            candidates.append(rl)
    if not candidates:
        raise FileNotFoundError(
            f"No run-latest.json under {chain_dir}"
        )

    # Most recent by mtime.
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    with open(candidates[0]) as f:
        return json.load(f)


def _extract_addresses(broadcast: dict) -> dict:
    """Mine the broadcast JSON for the 5 P3 contract addresses.

    Forge's `transactions[].contractName` + `contractAddress` pair
    keys each deploy. We map P3.* contract names to canonical
    deployed_base.json keys.
    """
    name_map = {
        "StealthAddressRegistry": "stealth_registry",
        "PrivacyRelayer":         "privacy_relayer",
        "UniswapPrivacyWrapper":  "uniswap_wrapper",
        "Groth16Verifier":        "privacy_verifier",
        "PrivacyPool":            "privacy_pool",
    }
    found: dict[str, str] = {}
    for tx in broadcast.get("transactions", []):
        cname = tx.get("contractName", "")
        addr = tx.get("contractAddress", "") or ""
        addr = addr.lower()
        if not addr.startswith("0x"):
            continue
        canonical = name_map.get(cname)
        if canonical and canonical not in found:
            found[canonical] = addr
    return found


def _merge_into_manifest(
    manifest_path: Path,
    addresses: dict,
    deployed_at: str,
    commit: str,
) -> None:
    if not manifest_path.is_file():
        # Forge writeJson quirk produced the file with only chainId on the
        # very first run; some runs may not have produced the file at all
        # (a clean deploy that fails forge write). Treat as a fresh write.
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        data = {}
    else:
        with open(manifest_path) as f:
            data = json.load(f)

    base = data.setdefault("base", {})
    if "chainId" not in base:
        base["chainId"] = 8453  # default for this script's caller
    base.update(addresses)
    base["deployedAt"] = deployed_at
    base["commit"] = commit

    with open(manifest_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _git_commit(repo_root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode().strip()
    except Exception:
        return "unknown"


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(
            "usage: merge_deploy_manifest.py "
            "<repo_root> <broadcast_dir> <manifest_path> <chain_id>",
            file=sys.stderr,
        )
        return 2

    repo_root, broadcast_dir, manifest_path, chain_id = argv[:4]
    repo_root_p = _resolve_path(repo_root)
    broadcast_dir_p = _resolve_path(broadcast_dir)
    manifest_p = _resolve_path(manifest_path)

    try:
        chain_id_int = int(chain_id)
    except ValueError:
        print(f"chain_id is not an int: {chain_id!r}", file=sys.stderr)
        return 2

    try:
        broadcast = _read_forge_broadcast(broadcast_dir_p, chain_id_int)
    except FileNotFoundError as e:
        print(f"Could not read Forge broadcast: {e}", file=sys.stderr)
        return 1

    addresses = _extract_addresses(broadcast)
    if not addresses:
        print(
            "No P3 contract addresses found in broadcast — "
            "is this the right Deploy.s.sol?",
            file=sys.stderr,
        )
        return 1

    # Refuse partial merges; we'd rather hard-fail than ship a manifest
    # missing a key contract.
    expected = {
        "stealth_registry", "privacy_relayer", "uniswap_wrapper",
        "privacy_verifier", "privacy_pool",
    }
    missing = expected - set(addresses)
    if missing:
        print(
            f"Missing P3 contract addresses in broadcast: "
            f"{sorted(missing)}. Aborting.",
            file=sys.stderr,
        )
        return 1

    deployed_at = (
        datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
    )
    commit = _git_commit(repo_root_p)

    _merge_into_manifest(manifest_p, addresses, deployed_at, commit)

    print(
        f"[merge_deploy_manifest] wrote {manifest_p} "
        f"({len(addresses)} contracts, deployedAt={deployed_at}, "
        f"commit={commit[:12]})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
