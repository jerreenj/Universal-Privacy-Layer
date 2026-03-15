#!/usr/bin/env python3
"""
UPL Contract Deployment Script
Deploys Privacy Relayer, Stealth Registry, and Uniswap Wrapper to testnets
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

# Chain configurations
CHAINS = {
    "ethereum_sepolia": {
        "rpc": "https://rpc.sepolia.org",
        "chain_id": 11155111,
        "explorer": "https://sepolia.etherscan.io",
        "uniswap_router": "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
        "weth": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
    },
    "arbitrum_sepolia": {
        "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
        "chain_id": 421614,
        "explorer": "https://sepolia.arbiscan.io",
        "uniswap_router": "0x101F443B4d1b059569D643917553c771E1b9663E",
        "weth": "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73"
    },
    "base_sepolia": {
        "rpc": "https://sepolia.base.org",
        "chain_id": 84532,
        "explorer": "https://sepolia.basescan.org",
        "uniswap_router": "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
        "weth": "0x4200000000000000000000000000000000000006"
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
            "outputSelection": {
                "*": {
                    "*": ["abi", "metadata", "evm.bytecode", "evm.sourceMap"]
                }
            },
            "optimizer": {
                "enabled": True,
                "runs": 200
            }
        }
    }, solc_version="0.8.20")
    
    contract_data = compiled["contracts"][f"{contract_name}.sol"][contract_name]
    return {
        "abi": contract_data["abi"],
        "bytecode": contract_data["evm"]["bytecode"]["object"]
    }

def deploy_contract(w3, account, compiled, constructor_args=None):
    """Deploy a contract"""
    Contract = w3.eth.contract(
        abi=compiled["abi"],
        bytecode=compiled["bytecode"]
    )
    
    # Build transaction
    if constructor_args:
        tx = Contract.constructor(*constructor_args).build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 3000000,
            "gasPrice": w3.eth.gas_price
        })
    else:
        tx = Contract.constructor().build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 3000000,
            "gasPrice": w3.eth.gas_price
        })
    
    # Sign and send
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    
    return receipt.contractAddress

def main():
    # Load deployer account from environment variable ONLY
    # SECURITY: Never hardcode seed phrases - always use environment variables
    Account.enable_unaudited_hdwallet_features()
    mnemonic = os.environ.get("DEPLOYER_MNEMONIC")
    
    if not mnemonic:
        print("\n" + "="*60)
        print("ERROR: DEPLOYER_MNEMONIC environment variable is required!")
        print("="*60)
        print("\nFor security, the seed phrase must be provided via environment variable.")
        print("Never commit seed phrases to code or repositories.\n")
        print("Usage:")
        print("  export DEPLOYER_MNEMONIC='your twelve word seed phrase here'")
        print("  python deploy.py")
        print("="*60)
        return
    
    account = Account.from_mnemonic(mnemonic)
    
    print(f"Deployer: {account.address}")
    
    # Select chain
    chain_key = os.environ.get("DEPLOY_CHAIN", "base_sepolia")
    chain = CHAINS[chain_key]
    
    print(f"\nDeploying to {chain_key}...")
    
    # Connect to chain
    w3 = Web3(Web3.HTTPProvider(chain["rpc"]))
    
    if not w3.is_connected():
        print("Failed to connect to RPC")
        return
    
    # Check balance
    balance = w3.eth.get_balance(account.address)
    print(f"Balance: {w3.from_wei(balance, 'ether')} ETH")
    
    if balance == 0:
        print("\nERROR: No ETH for gas. Get testnet ETH from:")
        print("  - Ethereum Sepolia: https://www.alchemy.com/faucets/ethereum-sepolia")
        print("  - Arbitrum Sepolia: https://www.alchemy.com/faucets/arbitrum-sepolia")
        print("  - Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet")
        return
    
    deployed = {}
    
    # Note: For actual deployment, you'd need to:
    # 1. Install OpenZeppelin contracts
    # 2. Compile with proper imports
    # 3. Deploy each contract
    
    print("\n=== DEPLOYMENT REQUIRES ===")
    print("1. Install dependencies:")
    print("   npm install @openzeppelin/contracts solc")
    print("")
    print("2. Fund deployer wallet with testnet ETH")
    print(f"   Address: {account.address}")
    print("")
    print("3. Run deployment:")
    print(f"   DEPLOY_CHAIN={chain_key} python deploy.py")
    print("")
    print("=== CONTRACTS TO DEPLOY ===")
    print("1. PrivacyRelayer.sol - Main privacy relayer")
    print("2. StealthAddressRegistry.sol - Stealth address registry")
    print("3. UniswapPrivacyWrapper.sol - DEX privacy wrapper")
    print("")
    print(f"Uniswap Router: {chain['uniswap_router']}")
    print(f"WETH: {chain['weth']}")

if __name__ == "__main__":
    main()
