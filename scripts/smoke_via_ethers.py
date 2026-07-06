#!/usr/bin/env python3
"""broadcast_smoke.py — broadcast the simpleSwapETHForToken tx using
   raw eth_sendTransaction (acts like a wallet over RPC). Bypasses
   the cast ABI encoding entirely so we know the call is correctly
   calldata-encoded for the wrapper.

   Reads the deployer key from contracts/.env.
"""
import json
import os
import subprocess
import sys
import time

ENV = r"C:\Users\AGBS Studio\ZCodeProject\Universal-Privacy-Layer\contracts\.env"
RPC = "https://mainnet.base.org"
WRAPPER = "0x009681CdF5441D23738EC6597e586eBB06215e3D"
WETH   = "0x4200000000000000000000000000000000000006"
USDC   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
AMOUNT_IN = 100000000000000  # 0.0001 ETH
DEADLINE_OFFSET = 900
DEPLOYER_RECIPIENT = "0x3f44A6451439673D95082A1337045a25ec275394"

# Read private key from .env (Windows fs)
with open(ENV, "r", encoding="utf-8") as f:
    priv = next(line for line in f if line.startswith("DEPLOYER_PRIVATE_KEY=")).split("=", 1)[1].strip()

# Build calldata: cast abi-encode.
# Behind the scenes we'll call `cast calldata` via wsl subprocess.
def cast_call(args):
    return subprocess.check_output(
        ["wsl.exe", "bash", "--login", "-c",
         f"'/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe' " + args],
        text=True
    ).strip()

print("== encoding calldata via cast ==")
CAL = (
    f"'calldata' 'privateSwapETHForToken(address,(address,address,bool)[],uint256,address,uint256)' "
    f"'{USDC}' '[({WETH},{USDC},false)]' '0' '{DEPLOYER_RECIPIENT}' "
    f"'{(int(time.time()) + DEADLINE_OFFSET)}'"
)
calldata = cast_call(CAL)
print(f"calldata length: {len(calldata)} bytes (incl. 0x)")
print(f"hex preview: {calldata[:80]}...")

# Estimate gas first with cast estimate
print("\n== estimate gas (dry-run) ==")
EST = (
    f"'estimate' '{WRAPPER}' '{calldata}' --value '{AMOUNT_IN}' --rpc-url '{RPC}'"
)
try:
    est = cast_call(EST)
    print(f"estimate_gas hex: {est}")
except subprocess.CalledProcessError as e:
    print("estimate failed:", e.output[:200])

# Send
print("\n== broadcast ==")
SEND = (
    f"'send' '{WRAPPER}' '{calldata}' --value '{AMOUNT_IN}' "
    f"--private-key '{priv}' --rpc-url '{RPC}' --json"
)
raw = cast_call(SEND)
print("raw:")
print(raw[:500])
data = json.loads(raw)
txhash = data.get("transactionHash")
print(f"\nTX: {txhash}")

# Now poll receipt
print("\n== wait for receipt ==")
RCPT = f"'receipt' '{txhash}' --rpc-url '{RPC}' --json 2>&1"
import time as _t
for attempt in range(60):
    _t.sleep(6)
    try:
        r = cast_call(RCPT)
        rd = json.loads(r)
        if rd.get("blockNumber"):
            print(f"MINED in block {rd['blockNumber']}, status={rd.get('status')}, gasUsed={rd.get('gasUsed')}")
            break
    except subprocess.CalledProcessError as e:
        pass
else:
    print("did not mine in 60s")

# Post-state: deployer ETH balance + USDC balance
print("\n== post-state ==")
BAL = f"'balance' '0x3f44A6451439673D95082A1337045a25ec275394' --rpc-url '{RPC}' --ether"
print(f"deployer ETH: {cast_call(BAL)}")
USDCB = f"'call' '{USDC}' 'balanceOf(address)(uint256)' '{DEPLOYER_RECIPIENT}' --rpc-url '{RPC}'"
print(f"deployer USDC: {cast_call(USDCB)}")

print(f"\nBasescan: https://basescan.org/tx/{txhash}")
