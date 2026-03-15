#!/usr/bin/env python3
"""
ZKP Verifier Deployment Script using solcjs
Deploys UPLVerifier contract to all 7 mainnet chains
"""

import os
import json
import subprocess
from web3 import Web3
from eth_account import Account

# Mainnet chain configurations
CHAINS = {
    "base": {
        "rpc": "https://mainnet.base.org",
        "chain_id": 8453,
        "explorer": "https://basescan.org"
    },
    "arbitrum": {
        "rpc": "https://arb1.arbitrum.io/rpc",
        "chain_id": 42161,
        "explorer": "https://arbiscan.io"
    },
    "polygon": {
        "rpc": "https://polygon-rpc.com",
        "chain_id": 137,
        "explorer": "https://polygonscan.com"
    },
    "optimism": {
        "rpc": "https://mainnet.optimism.io",
        "chain_id": 10,
        "explorer": "https://optimistic.etherscan.io"
    },
    "bnb": {
        "rpc": "https://bsc-dataseed1.binance.org",
        "chain_id": 56,
        "explorer": "https://bscscan.com"
    },
    "avalanche": {
        "rpc": "https://api.avax.network/ext/bc/C/rpc",
        "chain_id": 43114,
        "explorer": "https://snowtrace.io"
    },
    "hyperliquid": {
        "rpc": "https://rpc.hyperliquid.xyz/evm",
        "chain_id": 999,
        "explorer": "https://purrsec.com"
    }
}

def compile_with_solcjs():
    """Compile using solcjs"""
    print("Compiling UPLVerifier.sol with solcjs...")
    
    # Run solcjs
    result = subprocess.run(
        ["solcjs", "--bin", "--abi", "--optimize", "-o", "/app/contracts/build", "/app/contracts/UPLVerifier.sol"],
        capture_output=True, text=True
    )
    
    if result.returncode != 0:
        print(f"Compilation error: {result.stderr}")
        return None
    
    # Read compiled output
    bin_file = "/app/contracts/build/UPLVerifier_sol_UPLVerifier.bin"
    abi_file = "/app/contracts/build/UPLVerifier_sol_UPLVerifier.abi"
    
    with open(bin_file, 'r') as f:
        bytecode = f.read().strip()
    
    with open(abi_file, 'r') as f:
        abi = json.load(f)
    
    print(f"  Bytecode size: {len(bytecode)//2} bytes")
    return {"abi": abi, "bytecode": bytecode}

def deploy_contract(w3, account, compiled):
    """Deploy a compiled contract"""
    contract = w3.eth.contract(
        abi=compiled["abi"],
        bytecode=compiled["bytecode"]
    )
    
    # Get gas price with some buffer
    gas_price = w3.eth.gas_price
    
    # Build transaction
    tx = contract.constructor().build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 1500000,
        "gasPrice": gas_price
    })
    
    # Sign and send
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    
    print(f"  Tx: {tx_hash.hex()}")
    
    # Wait for receipt
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    
    return receipt["contractAddress"]

def main():
    # Create build directory
    os.makedirs("/app/contracts/build", exist_ok=True)
    
    # Compile
    compiled = compile_with_solcjs()
    if not compiled:
        print("Compilation failed!")
        return
    
    print("  ✓ Compiled successfully!")
    
    # Load deployer wallet
    seed_phrase = "inside post tool solar phone biology render blade broken draw hockey senior"
    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(seed_phrase)
    
    print(f"\nDeployer: {account.address}")
    print("="*60)
    
    # Deploy to each chain
    results = {}
    
    for chain_name, config in CHAINS.items():
        print(f"\n[{chain_name.upper()}]")
        
        try:
            w3 = Web3(Web3.HTTPProvider(config["rpc"], request_kwargs={'timeout': 30}))
            
            if not w3.is_connected():
                print(f"  Cannot connect to RPC")
                continue
            
            # Check balance
            balance = w3.eth.get_balance(account.address)
            balance_eth = float(w3.from_wei(balance, 'ether'))
            print(f"  Balance: {balance_eth:.6f}")
            
            if balance < w3.to_wei(0.0005, 'ether'):
                print(f"  SKIP: Low balance")
                continue
            
            # Deploy
            print("  Deploying...")
            address = deploy_contract(w3, account, compiled)
            print(f"  ✓ Deployed: {address}")
            print(f"  Explorer: {config['explorer']}/address/{address}")
            
            results[chain_name] = address
            
        except Exception as e:
            print(f"  ERROR: {str(e)[:80]}")
    
    # Summary
    print("\n" + "="*60)
    print("DEPLOYMENT SUMMARY - UPLVerifier")
    print("="*60)
    
    for chain, addr in results.items():
        print(f"  {chain}: {addr}")
    
    # Save results
    with open("/app/contracts/verifier_addresses.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\nSaved to /app/contracts/verifier_addresses.json")
    
    return results

if __name__ == "__main__":
    main()
