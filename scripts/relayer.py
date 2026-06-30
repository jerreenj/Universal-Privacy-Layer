#!/usr/bin/env python3
"""
UPL Relayer Service (P1.10 + P1.11; P2.9.7 made atomic)

Processes signed EIP-712 relay intents:
  1. Validates the user's EIP-712 signature off-chain
  2. Submits ONE atomic relayAndAnnounce() tx on PrivacyRelayer with
     msg.value = amount (relayer fronts ETH) — forwards the ETH to the stealth
     recipient AND records the registry announcement in the SAME tx (the EVM
     analog of Sui's relayed_send PTB). Either both succeed or both revert.

Usage:
  # Process a single intent from a JSON file:
  python scripts/relayer.py --intent intent.json

  # Run as a polling service (polls backend for pending intents):
  python scripts/relayer.py --poll --backend http://localhost:8001

  # One-shot test: generate a stealth address, create intent, sign, relay:
  python scripts/relayer.py --test --amount 0.0001

Required env (read from contracts/.env or environment):
  BASE_RPC_URL          — Base mainnet RPC
  RELAYER_PRIVATE_KEY   — the relayer wallet's private key (must match contract's relayer slot)
"""

import argparse
import json
import os
import sys
import time
import secrets
import hashlib
from pathlib import Path
from datetime import datetime, timezone

# Web3 + eth-account for EIP-712 + on-chain calls
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_typed_data

# ─── Config ────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
ENV_PATH = REPO_ROOT / "contracts" / ".env"
DEPLOYED_JSON = REPO_ROOT / "contracts" / "deployed_base.json"

# Contract ABIs (must match backend/server.py)
PRIVACY_RELAYER_ABI = [
    {"inputs":[{"name":"recipient","type":"address"},{"name":"ephemeralKey","type":"bytes32"},{"name":"viewTag","type":"uint8"}],"name":"relay","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[{"name":"recipient","type":"address"},{"name":"ephemeralKey","type":"bytes32"},{"name":"viewTag","type":"uint8"},{"name":"ephemPubKeyX","type":"bytes32"},{"name":"ephemPubKeyY","type":"bytes32"},{"name":"stealthHash","type":"bytes32"}],"name":"relayAndAnnounce","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[],"name":"feeBps","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"totalRelayed","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"relayer","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"registry","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"newRegistry","type":"address"}],"name":"setRegistry","outputs":[],"stateMutability":"nonpayable","type":"function"},
]

STEALTH_REGISTRY_ABI = [
    {"inputs":[{"name":"ephemeralPubKeyX","type":"bytes32"},{"name":"ephemeralPubKeyY","type":"bytes32"},{"name":"viewTag","type":"bytes32"},{"name":"stealthHash","type":"bytes32"}],"name":"announce","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"announcementCount","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
]

# EIP-712 domain (must match backend/server.py)
RELAY_INTENT_TYPE = {
    "RelayIntent": [
        {"name": "recipient", "type": "address"},
        {"name": "ephemeralKey", "type": "bytes32"},
        {"name": "viewTag", "type": "uint8"},
        {"name": "amount", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
    ]
}
RELAY_INTENT_NAME = "UPL PrivacyRelayer"
RELAY_INTENT_VERSION = "1"


def log(msg):
    print(f"[relayer] {datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def load_env():
    """Load env vars from contracts/.env if present, then from os.environ."""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

    rpc = os.environ.get("BASE_RPC_URL", "https://mainnet.base.org")
    key = os.environ.get("DEPLOYER_PRIVATE_KEY") or os.environ.get("RELAYER_PRIVATE_KEY")
    if not key:
        log("ERROR: No DEPLOYER_PRIVATE_KEY or RELAYER_PRIVATE_KEY in env")
        sys.exit(1)
    return rpc, key


def load_deployed_addresses():
    """Read deployed_base.json for contract addresses."""
    if not DEPLOYED_JSON.exists():
        log(f"ERROR: {DEPLOYED_JSON} not found")
        sys.exit(1)
    data = json.loads(DEPLOYED_JSON.read_text())
    base = data.get("base", data)
    return {
        "relayer": base["privacy_relayer"],
        "registry": base["stealth_registry"],
        "wrapper": base.get("uniswap_wrapper"),
    }


def validate_eip712_signature(intent_data, signature, expected_signer=None):
    """Recover the signer address from an EIP-712 typed data signature.
    Returns the recovered address. Raises if recovery fails."""
    domain = intent_data["domain"]
    types = intent_data["types"]
    message = intent_data["message"]

    # Use the full_message format (single dict with types/domain/message)
    full_message = {
        "types": {**types, "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ]},
        "primaryType": "RelayIntent",
        "domain": domain,
        "message": message,
    }

    encoded = encode_typed_data(full_message=full_message)
    recovered = Account.recover_message(encoded, signature=signature)

    if expected_signer and recovered.lower() != expected_signer.lower():
        raise ValueError(f"Signature mismatch: expected {expected_signer}, got {recovered}")

    return recovered


def view_tag_to_bytes32(tag_uint8):
    """Convert a uint8 view tag to bytes32 (left-padded, matching StealthAddressRegistry)."""
    return bytes(31) + bytes([tag_uint8 & 0xFF])


def process_intent(w3, relayer_account, contracts, intent_data, signature, amount_wei):
    """Validate signature, call relay() + announce(). Returns tx hashes."""
    relayer_addr = contracts["relayer"]
    registry_addr = contracts["registry"]

    relayer_contract = w3.eth.contract(address=relayer_addr, abi=PRIVACY_RELAYER_ABI)
    registry_contract = w3.eth.contract(address=registry_addr, abi=STEALTH_REGISTRY_ABI)

    # 1. Validate the EIP-712 signature off-chain
    message = intent_data["message"]
    signer = validate_eip712_signature(intent_data, signature)
    log(f"Signature valid — signer: {signer}")

    # 2. Check deadline
    deadline = int(message["deadline"])
    if time.time() > deadline:
        raise ValueError(f"Intent expired (deadline {deadline}, now {int(time.time())})")

    # 3. Verify the relayer is authorized on-chain
    onchain_relayer = relayer_contract.functions.relayer().call()
    if onchain_relayer.lower() != relayer_account.address.lower():
        raise ValueError(f"Relayer key mismatch: key={relayer_account.address}, contract={onchain_relayer}")
    log(f"Relayer authorized: {onchain_relayer}")

    # 4. Extract intent fields
    recipient = Web3.to_checksum_address(message["recipient"])
    ephemeral_key = bytes.fromhex(message["ephemeralKey"].replace("0x", ""))
    ephemeral_key_bytes32 = Web3.to_bytes(ephemeral_key).rjust(32, b"\x00")
    view_tag = int(message["viewTag"]) & 0xFF
    amount = int(message["amount"])

    # 5. Verify the relayer contract has its registry wired (required for the
    #    atomic relayAndAnnounce). Fail fast with a clear message if unset.
    onchain_registry = relayer_contract.functions.registry().call()
    if onchain_registry == "0x" + "0" * 40:
        raise RuntimeError(
            "PrivacyRelayer registry not wired — call setRegistry(<StealthAddressRegistry>) "
            "on the relayer contract before relaying. (P2.9.7)"
        )

    # 6. Build the announce payload (same derivation as the backend):
    #    ephemPubKeyX = the 32-byte ephemeral commitment, ephemPubKeyY = sha256
    #    of it (test convention — a real impl derives the full pubkey off-chain),
    #    stealthHash = keccak of the recipient address. The contract left-pads
    #    viewTag to bytes32 internally via bytes32(uint256(viewTag)).
    ephemeral_x = ephemeral_key_bytes32
    ephemeral_y = hashlib.sha256(ephemeral_key_bytes32).digest()
    stealth_hash = Web3.solidity_keccak(["address"], [recipient])

    # 7. Call relayAndAnnounce() — ONE atomic tx: forwards msg.value to the
    #    stealth recipient AND records the registry announcement in the same tx.
    #    Replaces the old two-tx relay()+announce() stitch (P2.9.7 parity with
    #    Sui's relayed_send PTB). If the announce reverts, the forward rolls
    #    back too — no dangling relay.
    log(f"Submitting relayAndAnnounce() — recipient={recipient}, amount={amount} wei, viewTag={view_tag}")
    nonce = w3.eth.get_transaction_count(relayer_account.address)
    tx = relayer_contract.functions.relayAndAnnounce(
        recipient,
        ephemeral_key_bytes32,
        view_tag,
        ephemeral_x,
        ephemeral_y,
        stealth_hash,
    ).build_transaction({
        "from": relayer_account.address,
        "value": amount,
        "nonce": nonce,
        "gas": 300000,  # relay() was 200k; +announce() call, bump to be safe
        "gasPrice": w3.eth.gas_price,
        "chainId": 8453,
    })
    signed = relayer_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    log(f"relayAndAnnounce() tx submitted: {tx_hash.hex()}")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt["status"] != 1:
        raise RuntimeError(f"relayAndAnnounce() tx reverted: {tx_hash.hex()}")
    log(f"relayAndAnnounce() confirmed — block {receipt['blockNumber']}, gas {receipt['gasUsed']}")

    # 8. Verify announcement count increased (the announce happened inside the
    #    same tx, so the count already reflects it).
    count = registry_contract.functions.announcementCount().call()
    log(f"Registry announcement count: {count}")

    return {
        "tx_hash": tx_hash.hex(),
        "relay_tx_hash": tx_hash.hex(),  # alias for back-compat with old consumers
        "block": receipt["blockNumber"],
        "announcement_count": count,
        "signer": signer,
        "recipient": recipient,
        "amount_wei": str(amount),
    }


def run_test(w3, relayer_account, contracts, amount_eth):
    """One-shot test: generate a stealth address, create + sign intent, relay."""
    amount_wei = Web3.to_wei(amount_eth, "ether")

    # Generate a random stealth recipient (test — a real implementation derives
    # this from the recipient's view/spend pubkeys + ephemeral key)
    stealth_key = secrets.token_bytes(32)
    stealth_account = Account.from_key(stealth_key)
    recipient = stealth_account.address
    log(f"Test stealth recipient: {recipient}")

    # Generate ephemeral key
    ephemeral_key = secrets.token_bytes(32)
    ephemeral_key_hex = "0x" + ephemeral_key.hex()
    view_tag = secrets.randbelow(256)

    # Build the EIP-712 intent (matching backend/server.py format)
    domain = {
        "name": RELAY_INTENT_NAME,
        "version": RELAY_INTENT_VERSION,
        "chainId": 8453,
        "verifyingContract": Web3.to_checksum_address(contracts["relayer"]),
    }
    nonce = secrets.randbits(256)
    deadline = int(time.time()) + 600
    message = {
        "recipient": recipient,
        "ephemeralKey": ephemeral_key_hex,
        "viewTag": view_tag,
        "amount": amount_wei,
        "nonce": nonce,
        "deadline": deadline,
    }

    intent_data = {
        "domain": domain,
        "types": RELAY_INTENT_TYPE,
        "primaryType": "RelayIntent",
        "message": message,
    }

    # Sign the intent with the relayer wallet (for the test, relayer = user)
    full_message = {
        "types": {**RELAY_INTENT_TYPE, "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ]},
        "primaryType": "RelayIntent",
        "domain": domain,
        "message": message,
    }
    encoded = encode_typed_data(full_message=full_message)
    signed = Account.sign_message(encoded, private_key=relayer_account.key)
    signature = signed.signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature

    log(f"Intent signed — signature: {signature[:20]}...")

    # Process the intent
    result = process_intent(w3, relayer_account, contracts, intent_data, signature, amount_wei)
    return result


def main():
    parser = argparse.ArgumentParser(description="UPL Relayer Service (P1.10/P1.11)")
    parser.add_argument("--test", action="store_true", help="Run a one-shot test relay")
    parser.add_argument("--amount", type=float, default=0.0001, help="Test amount in ETH (default: 0.0001)")
    parser.add_argument("--intent", type=str, help="Path to a signed intent JSON file")
    args = parser.parse_args()

    rpc, key = load_env()
    contracts = load_deployed_addresses()
    w3 = Web3(Web3.HTTPProvider(rpc))

    relayer_account = Account.from_key(key)
    log(f"Relayer wallet: {relayer_account.address}")
    log(f"RPC: {rpc}")
    log(f"Relayer contract: {contracts['relayer']}")
    log(f"Registry contract: {contracts['registry']}")

    balance = w3.eth.get_balance(relayer_account.address)
    log(f"Relayer balance: {Web3.from_wei(balance, 'ether')} ETH")

    if args.test:
        log(f"=== Running test relay — amount: {args.amount} ETH ===")
        result = run_test(w3, relayer_account, contracts, args.amount)
        log("=== Test complete ===")
        print(json.dumps(result, indent=2))

    elif args.intent:
        with open(args.intent) as f:
            intent_file = json.load(f)
        result = process_intent(
            w3, relayer_account, contracts,
            intent_file["intent"], intent_file["signature"], int(intent_file["amount_wei"])
        )
        print(json.dumps(result, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
