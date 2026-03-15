from fastapi import FastAPI, APIRouter, HTTPException, Body
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import hashlib
import secrets
from eth_account import Account
from eth_keys import keys
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
import base64
import json
from web3 import Web3

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Universal Privacy Layer API", version="1.0.0")
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Chain configurations - MAINNET
CHAIN_CONFIG = {
    "base": {
        "name": "Base",
        "chain_id": 8453,
        "rpc_url": "https://mainnet.base.org",
        "explorer": "https://basescan.org",
        "symbol": "ETH",
        "color": "#0052FF",
        "weth": "0x4200000000000000000000000000000000000006",
        "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    },
    "arbitrum": {
        "name": "Arbitrum One",
        "chain_id": 42161,
        "rpc_url": "https://arb1.arbitrum.io/rpc",
        "explorer": "https://arbiscan.io",
        "symbol": "ETH",
        "color": "#28A0F0",
        "weth": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "usdc": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    },
    "polygon": {
        "name": "Polygon",
        "chain_id": 137,
        "rpc_url": "https://rpc-mainnet.matic.quiknode.pro",
        "explorer": "https://polygonscan.com",
        "symbol": "POL",
        "color": "#8247E5",
        "weth": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        "usdc": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
    },
    "optimism": {
        "name": "Optimism",
        "chain_id": 10,
        "rpc_url": "https://mainnet.optimism.io",
        "explorer": "https://optimistic.etherscan.io",
        "symbol": "ETH",
        "color": "#FF0420",
        "weth": "0x4200000000000000000000000000000000000006",
        "usdc": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
    },
    "bnb": {
        "name": "BNB Chain",
        "chain_id": 56,
        "rpc_url": "https://bsc-dataseed1.binance.org/",
        "explorer": "https://bscscan.com",
        "symbol": "BNB",
        "color": "#F3BA2F",
        "weth": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "usdc": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
    },
    "avalanche": {
        "name": "Avalanche",
        "chain_id": 43114,
        "rpc_url": "https://api.avax.network/ext/bc/C/rpc",
        "explorer": "https://snowtrace.io",
        "symbol": "AVAX",
        "color": "#E84142",
        "weth": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
        "usdc": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
    },
    "hyperliquid": {
        "name": "Hyperliquid",
        "chain_id": 999,
        "rpc_url": "https://rpc.hyperliquid.xyz/evm",
        "explorer": "https://purrsec.com",
        "symbol": "HYPE",
        "color": "#00FF88",
        "weth": None,
        "usdc": None
    }
}

# UPL Contracts - DEPLOYED ON ALL 4 MAINNETS
# Same addresses across all chains (deterministic deployer nonce)
UPL_CONTRACTS = {
    "base": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://basescan.org"
    },
    "arbitrum": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://arbiscan.io"
    },
    "polygon": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://polygonscan.com"
    },
    "optimism": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://optimistic.etherscan.io"
    },
    "bnb": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://bscscan.com"
    },
    "avalanche": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://snowtrace.io"
    },
    "hyperliquid": {
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
        "uniswap_wrapper": None,
        "explorer": "https://purrsec.com"
    }
}

# Token configurations per chain
TOKENS = {
    "base": {
        "ETH": {"address": "native", "decimals": 18, "name": "Ethereum"},
        "WETH": {"address": "0x4200000000000000000000000000000000000006", "decimals": 18, "name": "Wrapped ETH"},
        "USDC": {"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6, "name": "USD Coin"},
        "DAI": {"address": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", "decimals": 18, "name": "Dai Stablecoin"},
        "USDbC": {"address": "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", "decimals": 6, "name": "USD Base Coin"},
    },
    "arbitrum": {
        "ETH": {"address": "native", "decimals": 18, "name": "Ethereum"},
        "WETH": {"address": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "decimals": 18, "name": "Wrapped ETH"},
        "USDC": {"address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "decimals": 6, "name": "USD Coin"},
        "DAI": {"address": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", "decimals": 18, "name": "Dai Stablecoin"},
        "ARB": {"address": "0x912CE59144191C1204E64559FE8253a0e49E6548", "decimals": 18, "name": "Arbitrum"},
    },
    "polygon": {
        "POL": {"address": "native", "decimals": 18, "name": "Polygon"},
        "WETH": {"address": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", "decimals": 18, "name": "Wrapped ETH"},
        "USDC": {"address": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "decimals": 6, "name": "USD Coin"},
        "USDT": {"address": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", "decimals": 6, "name": "Tether USD"},
    },
    "optimism": {
        "ETH": {"address": "native", "decimals": 18, "name": "Ethereum"},
        "WETH": {"address": "0x4200000000000000000000000000000000000006", "decimals": 18, "name": "Wrapped ETH"},
        "USDC": {"address": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "decimals": 6, "name": "USD Coin"},
        "OP": {"address": "0x4200000000000000000000000000000000000042", "decimals": 18, "name": "Optimism"},
    },
    "bnb": {
        "BNB": {"address": "native", "decimals": 18, "name": "BNB"},
        "WBNB": {"address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "decimals": 18, "name": "Wrapped BNB"},
        "USDC": {"address": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "decimals": 18, "name": "USD Coin"},
        "USDT": {"address": "0x55d398326f99059fF775485246999027B3197955", "decimals": 18, "name": "Tether USD"},
    },
    "avalanche": {
        "AVAX": {"address": "native", "decimals": 18, "name": "Avalanche"},
        "WAVAX": {"address": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "decimals": 18, "name": "Wrapped AVAX"},
        "USDC": {"address": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "decimals": 6, "name": "USD Coin"},
        "USDT": {"address": "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "decimals": 6, "name": "Tether USD"},
    },
    "hyperliquid": {
        "HYPE": {"address": "native", "decimals": 18, "name": "Hyperliquid"},
    }
}

# ===================== MODELS =====================

class StealthAddressRequest(BaseModel):
    public_address: str
    chain: str = "base"

class StealthAddressResponse(BaseModel):
    stealth_address: str
    ephemeral_public_key: str
    view_tag: str
    chain: str
    created_at: str

class PrivateTransactionRequest(BaseModel):
    from_address: str
    to_stealth_address: str
    amount_wei: str
    chain: str = "ethereum_sepolia"
    ephemeral_public_key: str

class EncryptedReceiptRequest(BaseModel):
    transaction_hash: str
    sender_address: str
    recipient_stealth_address: str
    amount_wei: str
    chain: str
    timestamp: str

class EncryptedReceiptResponse(BaseModel):
    receipt_id: str
    encrypted_data: str
    one_time_code: str
    created_at: str

class WalletCreateRequest(BaseModel):
    password: str

class WalletCreateResponse(BaseModel):
    wallet_id: str
    main_address: str
    privacy_address: str
    main_seed_phrase: str
    privacy_seed_phrase: str

class DecryptReceiptRequest(BaseModel):
    receipt_id: str
    one_time_code: str

# ===================== CRYPTO UTILITIES =====================

def generate_stealth_address(recipient_public_key_hex: str) -> tuple:
    """Generate a stealth address using ECDH key exchange"""
    # Generate ephemeral keypair
    ephemeral_private_key = secrets.token_bytes(32)
    ephemeral_account = Account.from_key(ephemeral_private_key)
    ephemeral_public_key = ephemeral_account.address
    
    # Create shared secret using hash of ephemeral public key and recipient
    shared_secret = hashlib.sha256(
        ephemeral_private_key + bytes.fromhex(recipient_public_key_hex[2:])
    ).digest()
    
    # Derive stealth private key
    stealth_private_key = hashlib.sha256(shared_secret).digest()
    stealth_account = Account.from_key(stealth_private_key)
    
    # View tag for quick scanning
    view_tag = hashlib.sha256(stealth_account.address.encode()).hexdigest()[:8]
    
    return stealth_account.address, ephemeral_public_key, view_tag

def encrypt_receipt(data: dict, password: str) -> tuple:
    """Encrypt receipt data with AES-256-GCM"""
    salt = secrets.token_bytes(16)
    key = PBKDF2(password.encode(), salt, dkLen=32, count=100000)
    
    cipher = AES.new(key, AES.MODE_GCM)
    plaintext = json.dumps(data).encode()
    ciphertext, tag = cipher.encrypt_and_digest(plaintext)
    
    # Combine all parts
    encrypted = base64.b64encode(
        salt + cipher.nonce + tag + ciphertext
    ).decode()
    
    return encrypted

def decrypt_receipt(encrypted_data: str, password: str) -> dict:
    """Decrypt receipt data"""
    data = base64.b64decode(encrypted_data)
    salt = data[:16]
    nonce = data[16:32]
    tag = data[32:48]
    ciphertext = data[48:]
    
    key = PBKDF2(password.encode(), salt, dkLen=32, count=100000)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    
    return json.loads(plaintext.decode())

def create_dual_wallet() -> dict:
    """Create a wallet with dual seed phrases"""
    Account.enable_unaudited_hdwallet_features()
    
    # Main wallet
    main_account, main_mnemonic = Account.create_with_mnemonic()
    
    # Privacy wallet (separate seed)
    privacy_account, privacy_mnemonic = Account.create_with_mnemonic()
    
    return {
        "main_address": main_account.address,
        "main_private_key": main_account.key.hex(),
        "main_mnemonic": main_mnemonic,
        "privacy_address": privacy_account.address,
        "privacy_private_key": privacy_account.key.hex(),
        "privacy_mnemonic": privacy_mnemonic
    }

# ===================== API ROUTES =====================

@api_router.get("/")
async def root():
    return {"message": "Universal Privacy Layer API", "version": "1.0.0"}

@api_router.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.get("/chains")
async def get_chains():
    """Get supported blockchain networks"""
    return {
        "chains": CHAIN_CONFIG,
        "contracts": UPL_CONTRACTS,
        "tokens": TOKENS,
        "live_chains": list(UPL_CONTRACTS.keys())
    }

# Get tokens for a chain
@api_router.get("/tokens/{chain}")
async def get_tokens(chain: str):
    """Get available tokens for a chain"""
    if chain not in TOKENS:
        raise HTTPException(status_code=400, detail="Unsupported chain")
    return {"chain": chain, "tokens": TOKENS[chain]}

@api_router.get("/deployer-info")
async def get_deployer_info():
    """Get deployer wallet info for all live chains"""
    deployer = "0x77483a981724fDa225EF78D8d3CF3c57a30193da"
    return {
        "deployer_address": deployer,
        "contracts_address": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "deployed_on": ["base", "arbitrum", "polygon", "optimism"],
        "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
        "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4"
    }

# Swap Quote API
class SwapQuoteRequest(BaseModel):
    chain: str = "base"
    token_in: str  # "ETH" or token address
    token_out: str  # "ETH" or token address
    amount_in: str  # Amount in wei/smallest unit

@api_router.post("/swap/quote")
async def get_swap_quote(request: SwapQuoteRequest):
    """Get a quote for a private swap via Uniswap"""
    try:
        if request.chain not in CHAIN_CONFIG:
            raise HTTPException(status_code=400, detail="Unsupported chain")
        
        config = CHAIN_CONFIG[request.chain]
        
        # Determine token addresses
        token_in = config["weth"] if request.token_in.upper() == "ETH" else request.token_in
        token_out = config["weth"] if request.token_out.upper() == "ETH" else request.token_out
        
        amount_in = int(request.amount_in)
        
        # Calculate fee (0.05%)
        fee = amount_in * 5 // 10000
        amount_after_fee = amount_in - fee
        
        # For testnet, provide estimated output (actual quote requires on-chain call)
        # Using a simple 1:1 estimate for testnets
        estimated_output = amount_after_fee
        
        return {
            "chain": request.chain,
            "token_in": token_in,
            "token_out": token_out,
            "amount_in": str(amount_in),
            "fee": str(fee),
            "fee_percent": "0.05%",
            "amount_after_fee": str(amount_after_fee),
            "estimated_output": str(estimated_output),
            "uniswap_router": config.get("uniswap_router"),
            "weth": config.get("weth"),
            "note": "Actual output may vary based on pool liquidity and slippage"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Swap quote error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Record a swap transaction
@api_router.post("/swap/record")
async def record_swap(
    tx_hash: str = Body(...),
    from_address: str = Body(...),
    token_in: str = Body(...),
    token_out: str = Body(...),
    amount_in: str = Body(...),
    amount_out: str = Body(...),
    chain: str = Body(...),
    recipient_stealth: str = Body(...)
):
    """Record a private swap transaction"""
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "tx_hash": tx_hash,
            "from_address": from_address,
            "token_in": token_in,
            "token_out": token_out,
            "amount_in": amount_in,
            "amount_out": amount_out,
            "chain": chain,
            "recipient_stealth": recipient_stealth,
            "tx_type": "private_swap",
            "status": "confirmed",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.transactions.insert_one(doc)
        return {"success": True, "swap_id": doc["id"]}
    except Exception as e:
        logger.error(f"Swap record error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Get available tokens for swapping
@api_router.get("/swap/tokens/{chain}")
async def get_swap_tokens(chain: str):
    """Get available tokens for swapping on a chain"""
    if chain not in CHAIN_CONFIG:
        raise HTTPException(status_code=400, detail="Unsupported chain")

    config = CHAIN_CONFIG[chain]
    native_symbol = config.get("symbol", "ETH")

    tokens = [
        {"symbol": native_symbol, "name": config["name"] + " native", "address": "native", "decimals": 18},
        {"symbol": "WETH", "name": "Wrapped Ethereum", "address": config.get("weth", ""), "decimals": 18},
        {"symbol": "USDC", "name": "USD Coin", "address": config.get("usdc", ""), "decimals": 6}
    ]

    return {"chain": chain, "tokens": tokens}

# Wallet Management
@api_router.post("/wallet/create", response_model=WalletCreateResponse)
async def create_wallet(request: WalletCreateRequest):
    """Create a new dual-key wallet (Main + Privacy)"""
    try:
        wallet_data = create_dual_wallet()
        wallet_id = str(uuid.uuid4())
        
        # Store encrypted wallet data
        encrypted_main = encrypt_receipt(
            {"private_key": wallet_data["main_private_key"]},
            request.password
        )
        encrypted_privacy = encrypt_receipt(
            {"private_key": wallet_data["privacy_private_key"]},
            request.password
        )
        
        doc = {
            "wallet_id": wallet_id,
            "main_address": wallet_data["main_address"],
            "privacy_address": wallet_data["privacy_address"],
            "encrypted_main": encrypted_main,
            "encrypted_privacy": encrypted_privacy,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.wallets.insert_one(doc)
        
        return WalletCreateResponse(
            wallet_id=wallet_id,
            main_address=wallet_data["main_address"],
            privacy_address=wallet_data["privacy_address"],
            main_seed_phrase=wallet_data["main_mnemonic"],
            privacy_seed_phrase=wallet_data["privacy_mnemonic"]
        )
    except Exception as e:
        logger.error(f"Wallet creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Stealth Address Generation
@api_router.post("/stealth/generate", response_model=StealthAddressResponse)
async def generate_stealth(request: StealthAddressRequest):
    """Generate a stealth address for private receiving"""
    try:
        stealth_address, ephemeral_pk, view_tag = generate_stealth_address(
            request.public_address
        )
        
        doc = {
            "id": str(uuid.uuid4()),
            "recipient_address": request.public_address,
            "stealth_address": stealth_address,
            "ephemeral_public_key": ephemeral_pk,
            "view_tag": view_tag,
            "chain": request.chain,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "used": False
        }
        await db.stealth_addresses.insert_one(doc)
        
        return StealthAddressResponse(
            stealth_address=stealth_address,
            ephemeral_public_key=ephemeral_pk,
            view_tag=view_tag,
            chain=request.chain,
            created_at=doc["created_at"]
        )
    except Exception as e:
        logger.error(f"Stealth generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Encrypted Receipt System
@api_router.post("/receipt/create", response_model=EncryptedReceiptResponse)
async def create_receipt(request: EncryptedReceiptRequest):
    """Create an encrypted transaction receipt with one-time code"""
    try:
        receipt_id = str(uuid.uuid4())
        one_time_code = secrets.token_hex(16)
        
        receipt_data = {
            "transaction_hash": request.transaction_hash,
            "sender": request.sender_address,
            "recipient": request.recipient_stealth_address,
            "amount_wei": request.amount_wei,
            "chain": request.chain,
            "timestamp": request.timestamp
        }
        
        encrypted = encrypt_receipt(receipt_data, one_time_code)
        
        doc = {
            "receipt_id": receipt_id,
            "encrypted_data": encrypted,
            "one_time_code_hash": hashlib.sha256(one_time_code.encode()).hexdigest(),
            "chain": request.chain,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.receipts.insert_one(doc)
        
        return EncryptedReceiptResponse(
            receipt_id=receipt_id,
            encrypted_data=encrypted,
            one_time_code=one_time_code,
            created_at=doc["created_at"]
        )
    except Exception as e:
        logger.error(f"Receipt creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/receipt/decrypt")
async def decrypt_receipt_api(request: DecryptReceiptRequest):
    """Decrypt a transaction receipt using one-time code"""
    try:
        receipt = await db.receipts.find_one({"receipt_id": request.receipt_id}, {"_id": 0})
        if not receipt:
            raise HTTPException(status_code=404, detail="Receipt not found")
        
        # Verify one-time code
        code_hash = hashlib.sha256(request.one_time_code.encode()).hexdigest()
        if code_hash != receipt["one_time_code_hash"]:
            raise HTTPException(status_code=401, detail="Invalid one-time code")
        
        decrypted = decrypt_receipt(receipt["encrypted_data"], request.one_time_code)
        return {"receipt": decrypted}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Receipt decryption error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Transaction History
@api_router.get("/transactions/{address}")
async def get_transactions(address: str, chain: str = "ethereum_sepolia"):
    """Get transaction history for an address"""
    try:
        transactions = await db.transactions.find(
            {"$or": [{"from_address": address}, {"to_address": address}], "chain": chain},
            {"_id": 0}
        ).to_list(100)
        return {"transactions": transactions}
    except Exception as e:
        logger.error(f"Transaction fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/transactions/record")
async def record_transaction(
    tx_hash: str = Body(...),
    from_address: str = Body(...),
    to_address: str = Body(...),
    amount_wei: str = Body(...),
    chain: str = Body(...),
    tx_type: str = Body(default="private_send"),
    status: str = Body(default="pending")
):
    """Record a private transaction"""
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "tx_hash": tx_hash,
            "from_address": from_address,
            "to_address": to_address,
            "amount_wei": amount_wei,
            "chain": chain,
            "tx_type": tx_type,
            "status": status,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.transactions.insert_one(doc)
        return {"success": True, "transaction_id": doc["id"]}
    except Exception as e:
        logger.error(f"Transaction record error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Stealth Address Scanning
@api_router.get("/stealth/scan/{address}")
async def scan_stealth_addresses(address: str):
    """Scan for stealth addresses belonging to an address"""
    try:
        stealth_addresses = await db.stealth_addresses.find(
            {"recipient_address": address},
            {"_id": 0}
        ).to_list(100)
        return {"stealth_addresses": stealth_addresses}
    except Exception as e:
        logger.error(f"Stealth scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Balance Aggregation (Hidden Balance Feature)
@api_router.get("/balance/{address}")
async def get_hidden_balance(address: str, chain: str = "ethereum_sepolia"):
    """Get aggregated balance across main and stealth addresses"""
    try:
        if chain not in CHAIN_CONFIG:
            raise HTTPException(status_code=400, detail="Unsupported chain")
        
        config = CHAIN_CONFIG[chain]
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        
        # Get main address balance
        main_balance = w3.eth.get_balance(Web3.to_checksum_address(address))
        
        # Get all stealth addresses for this user
        stealth_addresses = await db.stealth_addresses.find(
            {"recipient_address": address, "chain": chain},
            {"_id": 0, "stealth_address": 1}
        ).to_list(100)
        
        stealth_balance = 0
        for sa in stealth_addresses:
            try:
                bal = w3.eth.get_balance(Web3.to_checksum_address(sa["stealth_address"]))
                stealth_balance += bal
            except:
                pass
        
        total_balance = main_balance + stealth_balance
        
        return {
            "address": address,
            "chain": chain,
            "main_balance_wei": str(main_balance),
            "stealth_balance_wei": str(stealth_balance),
            "total_balance_wei": str(total_balance),
            "total_balance_eth": str(Web3.from_wei(total_balance, 'ether')),
            "symbol": config["symbol"]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Balance fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
