#!/usr/bin/env python3
"""List deploy tx hashes + addresses from contracts/broadcast/Deploy.s.sol/8453/run-latest.json."""
import json
import sys
import pathlib

LATEST = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(
    "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer/contracts/broadcast/Deploy.s.sol/8453/run-latest.json"
)
data = json.loads(LATEST.read_text())
print(f"== transactions from {LATEST.name} ==")
for tx in data.get("transactions", []):
    name = tx.get("contractName") or "?"
    h     = tx.get("hash") or "?"
    addr  = tx.get("contractAddress") or "?"
    fn    = tx.get("function") or "?"
    h_str = h[:18] + "…" if isinstance(h, str) and len(h) > 18 else str(h)
    a_str = addr[:14] + "…" if isinstance(addr, str) and len(addr) > 14 else str(addr)
    print(f"  {name:25} fn={fn:30} addr={a_str:18} tx={h_str}")
print()
print("== return values (predicted addresses) ==")
print(json.dumps(data.get("returns", {}), indent=2))
