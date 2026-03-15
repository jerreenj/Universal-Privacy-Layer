#!/usr/bin/env python3
"""
ZKP Verifier Deployment Script
Deploys Groth16Verifier contract to all 7 mainnet chains
"""

import os
import json
from web3 import Web3
from eth_account import Account
from solcx import compile_standard, install_solc

# Install solc
try:
    install_solc('0.8.20')
except:
    pass

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

def load_contract(filename):
    """Load contract source code"""
    with open(f"/app/contracts/{filename}", "r") as f:
        return f.read()

def compile_contract(source, contract_name):
    """Compile a Solidity contract"""
    compiled = compile_standard({
        "language": "Solidity",
        "sources": {
            f"{contract_name}.sol": {"content": source}
        },
        "settings": {
            "optimizer": {"enabled": True, "runs": 200},
            "outputSelection": {
                "*": {
                    "*": ["abi", "metadata", "evm.bytecode", "evm.sourceMap"]
                }
            }
        }
    }, solc_version="0.8.20")
    
    contract_data = compiled["contracts"][f"{contract_name}.sol"][contract_name]
    return {
        "abi": contract_data["abi"],
        "bytecode": contract_data["evm"]["bytecode"]["object"]
    }

def deploy_contract(w3, account, compiled, gas_price_gwei=None):
    """Deploy a compiled contract"""
    contract = w3.eth.contract(
        abi=compiled["abi"],
        bytecode=compiled["bytecode"]
    )
    
    # Build transaction
    tx_params = {
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 3000000,
    }
    
    if gas_price_gwei:
        tx_params["gasPrice"] = w3.to_wei(gas_price_gwei, "gwei")
    else:
        tx_params["gasPrice"] = w3.eth.gas_price
    
    # Create deployment transaction
    tx = contract.constructor().build_transaction(tx_params)
    
    # Sign and send
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    
    print(f"  Transaction sent: {tx_hash.hex()}")
    
    # Wait for receipt
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    
    return receipt["contractAddress"]

def main():
    # Load deployer wallet
    seed_phrase = "inside post tool solar phone biology render blade broken draw hockey senior"
    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(seed_phrase)
    
    print(f"Deployer address: {account.address}")
    print("="*60)
    
    # Compile Groth16Verifier
    print("\nCompiling Groth16Verifier...")
    source = load_contract("Groth16Verifier.sol")
    compiled = compile_contract(source, "Groth16Verifier")
    print("  Compiled successfully!")
    
    # Deploy to each chain
    results = {}
    
    for chain_name, config in CHAINS.items():
        print(f"\n[{chain_name.upper()}]")
        
        try:
            w3 = Web3(Web3.HTTPProvider(config["rpc"]))
            
            if not w3.is_connected():
                print(f"  ERROR: Cannot connect to {chain_name}")
                continue
            
            # Check balance
            balance = w3.eth.get_balance(account.address)
            balance_eth = w3.from_wei(balance, 'ether')
            print(f"  Balance: {balance_eth:.6f}")
            
            if balance < w3.to_wei(0.001, 'ether'):
                print(f"  SKIPPING: Insufficient balance")
                continue
            
            # Deploy
            print("  Deploying Groth16Verifier...")
            address = deploy_contract(w3, account, compiled)
            print(f"  ✓ Deployed at: {address}")
            print(f"  Explorer: {config['explorer']}/address/{address}")
            
            results[chain_name] = address
            
        except Exception as e:
            print(f"  ERROR: {str(e)[:100]}")
    
    # Summary
    print("\n" + "="*60)
    print("DEPLOYMENT SUMMARY")
    print("="*60)
    
    for chain, addr in results.items():
        print(f"  {chain}: {addr}")
    
    # Save results
    with open("/app/contracts/verifier_addresses.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\nResults saved to /app/contracts/verifier_addresses.json")
    
    return results

if __name__ == "__main__":
    main()
