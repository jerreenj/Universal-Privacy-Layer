#!/usr/bin/env python3
"""scripts/_adddenoms_wsl.py — owner-only cast send via WSL for the live
   Base mainnet multi-denom PrivacyPool. Adds (0.01 ETH, 1 ETH) so the
   pool exposes 3 denominations day-one. NEVER prints the priv-key, only
   first/last 6 hex."""
import json
import subprocess
import time

ENV_PATH = r"C:\Users\AGBS Studio\ZCodeProject\Universal-Privacy-Layer\contracts\.env"


def wsl_bash(shell_cmd):
    out = subprocess.run(
        ["wsl.exe", "bash", "--login", "-c", shell_cmd],
        capture_output=True, text=True, check=False,
    )
    if out.returncode != 0:
        print(f"WSL call failed (rc={out.returncode}): {shell_cmd}")
        print(f"STDERR: {out.stderr[:300]}")
    return out.stdout.strip()


def get_priv():
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("DEPLOYER_PRIVATE_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DEPLOYER_PRIVATE_KEY not found")


CAST = '"/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe"'
WALLET = '"/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts"'
POOL  = "0x3F0b23Aca0624981a503e8f042db2F3884D0C89C"
RPC   = "https://mainnet.base.org"
DENOMS = [("0.01 ETH", 10**16), ("1 ETH", 10**18)]

priv = get_priv()
print(f"PK: 0x{priv[2:6]}...{priv[-4:]} (len {len(priv)})")


def call_view(sig, *args):
    cmd = (
        f"cd {WALLET} && {CAST} call {POOL} \"{sig}\" "
        + " ".join(args) + f" --rpc-url {RPC}"
    )
    return wsl_bash(cmd)


# Pre-state
print("\n== pre-state ==")
for label, wei in DENOMS:
    print(f"  isDenominationEnabled({label}) = {call_view('isDenominationEnabled(uint256)(bool)', str(wei))}")
print(f"  denomList pre = {call_view('getDenominationList()(uint256[])')}")

# Broadcast
print("\n== broadcast ==")
for label, wei in DENOMS:
    cmd = (
        f"cd {WALLET} && {CAST} send {POOL} \"addDenomination(uint256)\" {wei}"
        f" --private-key \"{priv}\" --rpc-url {RPC} --json"
    )
    # If a previous tx in the same loop just landed, sleep so cast's
    # nonce-fetch on this call sees the post-mined value; without this
    # two rapid cast sends back-to-back can read stale nonce (cast sends
    # internally query at exec time, but the prev may not have mined yet).
    raw = None
    for attempt in range(3):
        raw = wsl_bash(cmd)
        if raw and "nonce too low" not in raw.lower():
            break
        print(f"  attempt {attempt + 1}: nonce too low; sleeping 4s and retrying…")
        time.sleep(4.0)
    if not raw:
        print(f"  addDenomination({label}) FAILED (empty response)")
        continue
    try:
        d = json.loads(raw)
        print(f"  addDenomination({label})={wei}")
        print(f"    tx       = {d.get('transactionHash')}")
        print(f"    block    = {d.get('blockNumber')}")
        print(f"    status   = {d.get('status')}")
        print(f"    gasUsed  = {d.get('gasUsed')}")
    except json.JSONDecodeError:
        print(f"  FAIL parsing JSON: {raw[:300]}")
        raise SystemExit(1)
    # Inter-tx breathing room for nonce propagation (Base ~2s blocks).
    time.sleep(3.0)

# Post-state
print("\n== post-state ==")
for label, wei in DENOMS:
    print(f"  isDenominationEnabled({label}) = {call_view('isDenominationEnabled(uint256)(bool)', str(wei))}")
print(f"  denomList post = {call_view('getDenominationList()(uint256[])')}")

# Final balance
addr = wsl_bash(f"cd {WALLET} && {CAST} wallet address --private-key \"{priv}\"")
final_bal = wsl_bash(f"cd {WALLET} && {CAST} balance {addr} --rpc-url {RPC} --ether")
print()
print(f"deployer: {addr}")
print(f"balance : {final_bal} ETH (after 2 addDenomination txs)")
