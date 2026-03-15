#!/usr/bin/env python3
"""
UPL Contract Deployment to Optimism Mainnet
Deploys PrivacyRelayer and StealthAddressRegistry
"""

from web3 import Web3
from eth_account import Account
import json
import time

# Optimism Mainnet Configuration
OPTIMISM_RPC = "https://mainnet.optimism.io"
CHAIN_ID = 10

# SECURITY: Never hardcode seed phrases - use environment variable
MNEMONIC = os.environ.get("DEPLOYER_MNEMONIC")

# PrivacyRelayer bytecode (same as Base deployment)
PRIVACY_RELAYER_BYTECODE = "608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506005600181905550610450806100686000396000f3fe60806040526004361061003f5760003560e01c806312065fe01461004457806354fd4d501461006f5780638da5cb5b1461009a578063ddca3f43146100c5575b600080fd5b34801561005057600080fd5b506100596100f0565b60405161006691906102d5565b60405180910390f35b34801561007b57600080fd5b506100846100f8565b60405161009191906102d5565b60405180910390f35b3480156100a657600080fd5b506100af6100fe565b6040516100bc919061032f565b60405180910390f35b3480156100d157600080fd5b506100da610122565b6040516100e791906102d5565b60405180910390f35b600047905090565b60015481565b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b60015481565b6000813590506101378161040c565b92915050565b60006020828403121561014f57600080fd5b600061015d84828501610128565b91505092915050565b6000819050919050565b61017981610166565b82525050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006101aa8261017f565b9050919050565b6101ba8161019f565b82525050565b60006020820190506101d560008301846101b1565b92915050565b60006020820190506101f06000830184610170565b92915050565b600080fd5b6102048161019f565b811461020f57600080fd5b50565b600081359050610221816101fb565b92915050565b6000819050919050565b61023a81610227565b811461024557600080fd5b50565b60008135905061025781610231565b92915050565b60008060408385031215610274576102736101f6565b5b600061028285828601610212565b925050602061029385828601610248565b9150509250929050565b6000346000146102b2576000341190505b806102c257506000341415155b6102cb57600080fd5b5050565b6102d881610166565b82525050565b60006020820190506102f360008301846102cf565b92915050565b6000602082019050818103600083015261031281610349565b9050919050565b600060208201905061032e60008301846101b1565b92915050565b600061033f8261017f565b9050919050565b7f556e6976657273616c205072697661637920526f7574657200000000000000006000820152565b61037781610166565b811461038257600080fd5b50565b600081519050610394816101fb565b92915050565b6000602082840312156103b0576103af6101f6565b5b60006103be84828501610385565b91505092915050565b6103d08161019f565b81146103db57600080fd5b50565b6000813590506103ed816103c7565b92915050565b6000819050919050565b610406816103f3565b82525050565b61041581610166565b811461042057600080fd5b5056fea264697066735822122000000000000000000000000000000000000000000000000000000000000000000064736f6c63430008000033"

# StealthAddressRegistry bytecode (same as Base deployment)
STEALTH_REGISTRY_BYTECODE = "608060405234801561001057600080fd5b50610300806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80636d3d14161461003b578063997da8d414610057575b600080fd5b61005560048036038101906100509190610198565b610075565b005b61005f610122565b60405161006c919061020a565b60405180910390f35b60008383836040516020016100909392919061025e565b604051602081830303815290604052805190602001209050600080549050600160008190555081837f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9254260405161010091906102ae565b60405180910390a3505050505050565b60008054905090565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006101498261011e565b9050919050565b6101598161013e565b811461016457600080fd5b50565b60008135905061017681610150565b92915050565b6000819050919050565b61018f8161017c565b811461019a57600080fd5b50565b6000813590506101ac81610186565b92915050565b6000806000606084860312156101cb576101ca610119565b5b60006101d986828701610167565b93505060206101ea86828701610167565b92505060406101fb8682870161019d565b9150509250925092565b6000819050919050565b61021881610205565b82525050565b6000602082019050610233600083018461020f565b92915050565b6102428161013e565b82525050565b6102518161017c565b82525050565b600060608201905061026c6000830186610239565b6102796020830185610239565b6102866040830184610248565b949350505050565b6000819050919050565b6102a18161028e565b82525050565b60006020820190506102bc6000830184610298565b9291505056fea2646970667358221220000000000000000000000000000000000000000000000000000000000000000064736f6c63430008000033"


def deploy():
    print("=" * 60)
    print("UPL MAINNET DEPLOYMENT - OPTIMISM")
    print("=" * 60)

    # Connect
    w3 = Web3(Web3.HTTPProvider(OPTIMISM_RPC, request_kwargs={'timeout': 60}))
    if not w3.is_connected():
        print("ERROR: Cannot connect to Optimism")
        return {}

    print(f"Connected to Optimism (Chain ID: {CHAIN_ID})")

    # Load account
    Account.enable_unaudited_hdwallet_features()
    account = Account.from_mnemonic(MNEMONIC)
    print(f"Deployer: {account.address}")

    # Check balance
    balance = w3.eth.get_balance(account.address)
    balance_eth = w3.from_wei(balance, 'ether')
    print(f"Balance: {balance_eth:.8f} ETH")

    if balance == 0:
        print("ERROR: No ETH for gas")
        return {}

    # Get current nonce and gas price
    nonce = w3.eth.get_transaction_count(account.address)
    gas_price = w3.eth.gas_price
    # Use at least 1 gwei to ensure tx goes through
    gas_price = max(gas_price, w3.to_wei(1, 'gwei'))
    print(f"Starting nonce: {nonce}")
    print(f"Gas Price: {w3.from_wei(gas_price, 'gwei'):.4f} gwei")

    deployed = {}

    # Deploy PrivacyRelayer
    print("\n[1/2] Deploying PrivacyRelayer...")
    try:
        tx = {
            'chainId': CHAIN_ID,
            'gas': 600000,
            'gasPrice': gas_price,
            'nonce': nonce,
            'data': '0x' + PRIVACY_RELAYER_BYTECODE
        }
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"  TX Hash: {tx_hash.hex()}")
        print("  Waiting for confirmation (timeout=300s)...")
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        if receipt.status == 1:
            deployed['privacy_relayer'] = receipt.contractAddress
            print(f"  DEPLOYED: {receipt.contractAddress}")
            print(f"  Gas Used: {receipt.gasUsed}")
        else:
            print(f"  FAILED (status=0)")
        nonce += 1
    except Exception as e:
        print(f"  ERROR: {e}")
        nonce += 1

    # Deploy StealthRegistry
    print("\n[2/2] Deploying StealthAddressRegistry...")
    try:
        tx = {
            'chainId': CHAIN_ID,
            'gas': 500000,
            'gasPrice': gas_price,
            'nonce': nonce,
            'data': '0x' + STEALTH_REGISTRY_BYTECODE
        }
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        print(f"  TX Hash: {tx_hash.hex()}")
        print("  Waiting for confirmation (timeout=300s)...")
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        if receipt.status == 1:
            deployed['stealth_registry'] = receipt.contractAddress
            print(f"  DEPLOYED: {receipt.contractAddress}")
            print(f"  Gas Used: {receipt.gasUsed}")
        else:
            print(f"  FAILED (status=0)")
    except Exception as e:
        print(f"  ERROR: {e}")

    # Final
    final_balance = w3.eth.get_balance(account.address)
    spent = balance - final_balance
    print(f"\n{'='*60}")
    print("DEPLOYMENT COMPLETE")
    print(f"{'='*60}")
    print(f"Gas Spent: {w3.from_wei(spent, 'ether'):.8f} ETH")
    print(f"Remaining: {w3.from_wei(final_balance, 'ether'):.8f} ETH")
    print(f"\nContracts Deployed:")
    for name, addr in deployed.items():
        print(f"  {name}: {addr}")

    # Save to file
    with open('/app/contracts/deployed_optimism.json', 'w') as f:
        json.dump({
            'network': 'optimism_mainnet',
            'chain_id': CHAIN_ID,
            'deployer': account.address,
            'contracts': deployed
        }, f, indent=2)

    print(f"\nView on Optimism Explorer:")
    for name, addr in deployed.items():
        print(f"  https://optimistic.etherscan.io/address/{addr}")

    return deployed


if __name__ == "__main__":
    result = deploy()
    print(f"\nResult: {result}")
