from fastapi import FastAPI, APIRouter, HTTPException, Body, Depends, Request as FastAPIRequest
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
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
import re
import httpx
from web3 import Web3

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=False)  # Railway injects env vars; .env is optional

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', '')
if not mongo_url:
    raise RuntimeError("MONGO_URL environment variable is required")
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'upl_database')]

app = FastAPI(
    title="Universal Privacy Layer API",
    version="1.0.0",
    docs_url=None,        # Disable public Swagger UI
    redoc_url=None,       # Disable public ReDoc
    openapi_url=None      # Disable public OpenAPI schema
)
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ── Protected router — all routes below require a valid session token ──────────
protected_router = APIRouter(prefix="/api", dependencies=[Depends(lambda request: require_auth(request))])

# ── Security Headers Middleware ───────────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from collections import defaultdict
import time as _time

# ── In-memory rate limiter ────────────────────────────────────────────────────
_rate_store: dict = defaultdict(list)

def rate_limit(request: StarletteRequest, max_calls: int = 20, window: int = 60):
    """Allow max_calls per IP per window seconds. Raises 429 if exceeded."""
    ip = request.client.host if request.client else "unknown"
    now = _time.time()
    calls = [t for t in _rate_store[ip] if now - t < window]
    calls.append(now)
    _rate_store[ip] = calls
    if len(calls) > max_calls:
        raise HTTPException(status_code=429, detail="Too many requests")

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    # Public endpoints that don't require a session token
    PUBLIC_PATHS = {"/api/health", "/api/", "/api/auth/verify-access"}

    async def dispatch(self, request: StarletteRequest, call_next):
        # ── Auth gate — block all /api/* except public paths ──────────────────
        path = request.url.path
        if path.startswith("/api/") and path not in self.PUBLIC_PATHS:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return JSONResponse({"detail": "Authorization required"}, status_code=401)
            token = auth.split(" ", 1)[1]
            exp = _sessions.get(token)
            if not exp or _time.time() > exp:
                _sessions.pop(token, None)
                return JSONResponse({"detail": "Session expired — re-authenticate"}, status_code=401)

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── Session Token Auth ────────────────────────────────────────────────────────
# After /auth/verify-access, frontend gets a short-lived session token.
# Every other endpoint requires: Authorization: Bearer <token>
_sessions: dict = {}  # token -> expiry timestamp
SESSION_TTL = 60 * 60 * 72  # 72 hours

def _new_token() -> str:
    return secrets.token_hex(32)

def require_auth(request: StarletteRequest):
    """Dependency: validates session token on every protected endpoint."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization required")
    token = auth.split(" ", 1)[1]
    exp = _sessions.get(token)
    if not exp or _time.time() > exp:
        _sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Session expired — re-authenticate")
    return token

# ── EVM address validator ─────────────────────────────────────────────────────
_EVM_RE = re.compile(r'^0x[a-fA-F0-9]{40}$')

def validate_address(addr: str) -> str:
    """Raise 400 if not a valid EVM address. Returns checksum address."""
    if not _EVM_RE.match(addr or ""):
        raise HTTPException(status_code=400, detail="Invalid EVM address format")
    return Web3.to_checksum_address(addr)

# ── Request body size limit (1 MB) ────────────────────────────────────────────
class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_048_576:
            raise HTTPException(status_code=413, detail="Request too large")
        return await call_next(request)

app.add_middleware(RequestSizeLimitMiddleware)

# ZKP Verifier addresses (deployed on all chains)
ZKP_VERIFIER_ADDRESSES = {
    "base": "0x98940B431d829832d2Ad5eB0812824A3C40D1bF1",
    "arbitrum": "0xbdFc25A62dcCFbc710072Ae2EaE5c3a57674bDad",
    "optimism": "0xD04f9cE68CfF7C0FD6d631794964784B99423943",
    "bnb": "0xD04f9cE68CfF7C0FD6d631794964784B99423943",
    "avalanche": "0xD04f9cE68CfF7C0FD6d631794964784B99423943",
    "hyperliquid": "0xD04f9cE68CfF7C0FD6d631794964784B99423943",
    "polygon": "0xD04f9cE68CfF7C0FD6d631794964784B99423943"
}

# ZKP Verifier ABI
ZKP_VERIFIER_ABI = [
    {"inputs":[{"name":"a","type":"uint256[2]"},{"name":"b","type":"uint256[2][2]"},{"name":"c","type":"uint256[2]"},{"name":"input","type":"uint256[2]"}],"name":"verifyProof","outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"a","type":"uint256[2]"},{"name":"b","type":"uint256[2][2]"},{"name":"c","type":"uint256[2]"},{"name":"input","type":"uint256[2]"}],"name":"verifyProofView","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"nullifier","type":"bytes32"}],"name":"isNullifierUsed","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"getStats","outputs":[{"name":"","type":"uint256"},{"name":"","type":"uint256"},{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]

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
    pass  # No sensitive fields accepted — keys generated server-side, returned once, never stored

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
    """
    Create a wallet with dual seed phrases.
    Returns addresses and mnemonics ONLY — private keys never leave this function.
    """
    Account.enable_unaudited_hdwallet_features()

    # Main wallet
    main_account, main_mnemonic = Account.create_with_mnemonic()

    # Privacy wallet (separate seed)
    privacy_account, privacy_mnemonic = Account.create_with_mnemonic()

    # SECURITY: Never include private keys in the returned dict
    return {
        "main_address": main_account.address,
        "main_mnemonic": main_mnemonic,
        "privacy_address": privacy_account.address,
        "privacy_mnemonic": privacy_mnemonic
    }

# ===================== API ROUTES =====================

@api_router.get("/")
async def root():
    return {"message": "Universal Privacy Layer API", "version": "1.0.0"}

@api_router.post("/auth/verify-access")
async def verify_access(request: StarletteRequest, code: str = Body(..., embed=True)):
    """Verify access code — issues session token valid for 8 hours. 5 attempts/min per IP."""
    rate_limit(request, max_calls=5, window=60)
    expected = os.environ.get("ACCESS_CODE", "")
    if not expected or code != expected:
        raise HTTPException(status_code=401, detail="Invalid access code")
    token = _new_token()
    _sessions[token] = _time.time() + SESSION_TTL
    return {"granted": True, "token": token, "expires_in": SESSION_TTL}

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
async def create_wallet(request: StarletteRequest):
    """
    Create a new dual-key wallet. Rate limited: 3 per minute per IP.
    SECURITY: Private keys and seed phrases are generated here and returned ONCE.
    They are NEVER stored server-side.
    """
    rate_limit(request, max_calls=3, window=60)
    try:
        wallet_data = create_dual_wallet()
        wallet_id = str(uuid.uuid4())

        # Store ONLY public addresses — NEVER store private keys or mnemonics
        doc = {
            "wallet_id": wallet_id,
            "main_address": wallet_data["main_address"],
            "privacy_address": wallet_data["privacy_address"],
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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
            except Exception:
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
        raise HTTPException(status_code=500, detail="An internal error occurred")

# ===================== ENHANCED FEATURES =====================

# --- Hidden Balance (Aggregated across all stealth addresses) ---
@api_router.get("/balance/hidden/{address}")
async def get_full_hidden_balance(address: str):
    """Get aggregated balance across ALL chains and stealth addresses"""
    try:
        result = {
            "address": address,
            "chains": {},
            "total_usd_value": "0",
            "stealth_address_count": 0
        }
        
        # Get all stealth addresses for this user across all chains
        all_stealth = await db.stealth_addresses.find(
            {"recipient_address": address},
            {"_id": 0}
        ).to_list(500)
        
        result["stealth_address_count"] = len(all_stealth)
        
        # Group by chain
        stealth_by_chain = {}
        for sa in all_stealth:
            chain = sa.get("chain", "base")
            if chain not in stealth_by_chain:
                stealth_by_chain[chain] = []
            stealth_by_chain[chain].append(sa["stealth_address"])
        
        # Fetch balances for each chain
        for chain_key, config in CHAIN_CONFIG.items():
            try:
                w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
                
                # Main balance
                try:
                    main_bal = w3.eth.get_balance(Web3.to_checksum_address(address))
                except Exception:
                    main_bal = 0
                
                # Stealth balances
                stealth_bal = 0
                stealth_addrs = stealth_by_chain.get(chain_key, [])
                stealth_with_balance = []
                
                for sa in stealth_addrs:
                    try:
                        bal = w3.eth.get_balance(Web3.to_checksum_address(sa))
                        if bal > 0:
                            stealth_with_balance.append({
                                "address": sa,
                                "balance_wei": str(bal),
                                "balance": str(Web3.from_wei(bal, 'ether'))
                            })
                        stealth_bal += bal
                    except Exception:
                        pass
                
                total = main_bal + stealth_bal
                
                result["chains"][chain_key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "main_balance_wei": str(main_bal),
                    "main_balance": str(Web3.from_wei(main_bal, 'ether')),
                    "stealth_balance_wei": str(stealth_bal),
                    "stealth_balance": str(Web3.from_wei(stealth_bal, 'ether')),
                    "total_balance_wei": str(total),
                    "total_balance": str(Web3.from_wei(total, 'ether')),
                    "stealth_addresses_with_balance": stealth_with_balance,
                    "color": config["color"]
                }
            except Exception as e:
                logger.warning(f"Failed to fetch balance for {chain_key}: {e}")
                result["chains"][chain_key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "error": str(e)
                }
        
        return result
    except Exception as e:
        logger.error(f"Hidden balance error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- Transaction History (Enhanced) ---
@api_router.get("/transactions/history/{address}")
async def get_full_transaction_history(address: str, limit: int = 50):
    """Get complete transaction history across all chains"""
    try:
        # Get transactions where user is sender or recipient
        transactions = await db.transactions.find(
            {"$or": [
                {"from_address": {"$regex": re.escape(address), "$options": "i"}},
                {"to_address": {"$regex": re.escape(address), "$options": "i"}},
                {"recipient_stealth": {"$regex": re.escape(address), "$options": "i"}}
            ]},
            {"_id": 0}
        ).sort("created_at", -1).to_list(limit)
        
        # Get stealth addresses to check for incoming
        stealth_addrs = await db.stealth_addresses.find(
            {"recipient_address": address},
            {"_id": 0, "stealth_address": 1, "chain": 1, "created_at": 1}
        ).to_list(500)
        
        stealth_set = {sa["stealth_address"].lower() for sa in stealth_addrs}
        
        # Enrich transactions with direction
        for tx in transactions:
            from_addr = tx.get("from_address", "").lower()
            to_addr = tx.get("to_address", "").lower()
            recipient_stealth = tx.get("recipient_stealth", "").lower()
            
            if from_addr == address.lower():
                tx["direction"] = "out"
            elif to_addr == address.lower() or to_addr in stealth_set or recipient_stealth in stealth_set:
                tx["direction"] = "in"
            else:
                tx["direction"] = "unknown"
        
        return {
            "address": address,
            "transactions": transactions,
            "total_count": len(transactions),
            "stealth_addresses_count": len(stealth_addrs)
        }
    except Exception as e:
        logger.error(f"Transaction history error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- Privacy Wallet Registration ---
class PrivacyWalletRegister(BaseModel):
    main_address: str
    privacy_spend_key: str  # Public key for spending
    privacy_view_key: str   # Public key for viewing
    encrypted_private_data: Optional[str] = None

@api_router.post("/wallet/register-privacy")
async def register_privacy_wallet(request: PrivacyWalletRegister):
    """Register privacy keys for an existing wallet"""
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "main_address": request.main_address,
            "privacy_spend_key": request.privacy_spend_key,
            "privacy_view_key": request.privacy_view_key,
            "encrypted_private_data": request.encrypted_private_data,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Upsert - update if exists, insert if not
        await db.privacy_wallets.update_one(
            {"main_address": request.main_address},
            {"$set": doc},
            upsert=True
        )
        
        return {"success": True, "wallet_id": doc["id"]}
    except Exception as e:
        logger.error(f"Privacy wallet registration error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/wallet/privacy/{address}")
async def get_privacy_wallet(address: str):
    """Get privacy wallet info for an address"""
    try:
        wallet = await db.privacy_wallets.find_one(
            {"main_address": address},
            {"_id": 0}
        )
        if not wallet:
            return {"registered": False}
        return {"registered": True, "wallet": wallet}
    except Exception as e:
        logger.error(f"Privacy wallet fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- NFT Privacy Proxy ---
class NFTProxyRequest(BaseModel):
    user_address: str
    nft_contract: str
    token_id: str
    action: str  # "buy", "sell", "transfer", "bid"
    chain: str = "base"
    price_wei: Optional[str] = None
    recipient: Optional[str] = None

@api_router.post("/nft/proxy")
async def create_nft_proxy_transaction(request: NFTProxyRequest):
    """Create a privacy-wrapped NFT transaction"""
    try:
        # Generate a proxy address for this NFT interaction
        proxy_private_key = secrets.token_bytes(32)
        proxy_account = Account.from_key(proxy_private_key)
        
        proxy_id = str(uuid.uuid4())
        
        doc = {
            "proxy_id": proxy_id,
            "user_address": request.user_address,
            "proxy_address": proxy_account.address,
            "nft_contract": request.nft_contract,
            "token_id": request.token_id,
            "action": request.action,
            "chain": request.chain,
            "price_wei": request.price_wei,
            "recipient": request.recipient,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.nft_proxies.insert_one(doc)
        
        return {
            "proxy_id": proxy_id,
            "proxy_address": proxy_account.address,
            "instructions": f"Send funds to proxy address, then call execute endpoint",
            "action": request.action
        }
    except Exception as e:
        logger.error(f"NFT proxy error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- Token Approval Privacy ---
class TokenApprovalRequest(BaseModel):
    user_address: str
    token_address: str
    spender_address: str
    amount: str
    chain: str = "base"

@api_router.post("/approval/create-disposable")
async def create_disposable_approval(request: TokenApprovalRequest):
    """Create a disposable address for token approval"""
    try:
        # Generate disposable approval address
        disposable_key = secrets.token_bytes(32)
        disposable_account = Account.from_key(disposable_key)
        
        approval_id = str(uuid.uuid4())
        
        doc = {
            "approval_id": approval_id,
            "user_address": request.user_address,
            "disposable_address": disposable_account.address,
            "token_address": request.token_address,
            "spender_address": request.spender_address,
            "amount": request.amount,
            "chain": request.chain,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.disposable_approvals.insert_one(doc)
        
        return {
            "approval_id": approval_id,
            "disposable_address": disposable_account.address,
            "instructions": "Transfer tokens to disposable address, approve from there, then sweep back"
        }
    except Exception as e:
        logger.error(f"Disposable approval error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- Smart Contract Privacy Proxy ---
class ContractProxyRequest(BaseModel):
    user_address: str
    contract_address: str
    function_name: str
    function_args: List[Any]
    chain: str = "base"
    value_wei: str = "0"

@api_router.post("/contract/proxy")
async def create_contract_proxy(request: ContractProxyRequest):
    """Create anonymous execution proxy for smart contract calls"""
    try:
        # Generate proxy address
        proxy_key = secrets.token_bytes(32)
        proxy_account = Account.from_key(proxy_key)
        
        proxy_id = str(uuid.uuid4())
        
        doc = {
            "proxy_id": proxy_id,
            "user_address": request.user_address,
            "proxy_address": proxy_account.address,
            "contract_address": request.contract_address,
            "function_name": request.function_name,
            "function_args": request.function_args,
            "chain": request.chain,
            "value_wei": request.value_wei,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.contract_proxies.insert_one(doc)
        
        return {
            "proxy_id": proxy_id,
            "proxy_address": proxy_account.address,
            "instructions": "Fund proxy address with gas + value, then execute contract call from proxy"
        }
    except Exception as e:
        logger.error(f"Contract proxy error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- Relayer Stats ---
@api_router.get("/stats")
async def get_platform_stats():
    """Get platform statistics"""
    try:
        total_txs = await db.transactions.count_documents({})
        total_stealth = await db.stealth_addresses.count_documents({})
        total_wallets = await db.wallets.count_documents({})
        total_receipts = await db.receipts.count_documents({})
        
        return {
            "total_transactions": total_txs,
            "total_stealth_addresses": total_stealth,
            "total_wallets": total_wallets,
            "total_receipts": total_receipts,
            "live_chains": list(CHAIN_CONFIG.keys()),
            "contracts": {
                "privacy_relayer": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
                "stealth_registry": "0xf2E7A6734E58774A8417c176AaE3898667699Ff4"
            }
        }
    except Exception as e:
        logger.error(f"Stats error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# ===================== NEW FEATURES =====================

# --- 1. ZKP PROOFS INTEGRATION ---
class ZKPProofRequest(BaseModel):
    proof_type: str  # "stealth_ownership", "amount_range", "membership"
    public_inputs: List[str]
    proof_a: List[str]
    proof_b: List[List[str]]
    proof_c: List[str]

class ZKPVerifyRequest(BaseModel):
    proof_id: str
    chain: str = "base"

@api_router.post("/zkp/generate-inputs")
async def generate_zkp_inputs(
    stealth_address: str = Body(...),
    spend_key_hash: str = Body(...),
    view_key_hash: str = Body(...)
):
    """Generate public inputs for ZKP proof"""
    try:
        # Hash the stealth address for the circuit
        stealth_hash = hashlib.sha256(bytes.fromhex(stealth_address[2:])).hexdigest()
        
        # Generate circuit inputs
        inputs = {
            "stealth_address_hash": "0x" + stealth_hash,
            "spend_key_commitment": spend_key_hash,
            "view_key_commitment": view_key_hash,
            "nullifier": "0x" + secrets.token_hex(32),
            "timestamp": int(datetime.now(timezone.utc).timestamp())
        }
        
        # Store for later verification
        input_id = str(uuid.uuid4())
        await db.zkp_inputs.insert_one({
            "input_id": input_id,
            "inputs": inputs,
            "stealth_address": stealth_address,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "verified": False
        })
        
        return {
            "input_id": input_id,
            "public_inputs": inputs,
            "circuit_type": "stealth_ownership",
            "instructions": "Use snarkjs to generate proof with these inputs"
        }
    except Exception as e:
        logger.error(f"ZKP input generation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

class ZKPVerifyOnChainRequest(BaseModel):
    proof_a: List[str]
    proof_b: List[List[str]]
    proof_c: List[str]
    public_inputs: List[str]
    chain: str = "base"

@api_router.post("/zkp/submit-proof")
async def submit_zkp_proof(request: ZKPProofRequest):
    """Submit a ZKP proof for verification"""
    try:
        proof_id = str(uuid.uuid4())
        
        # Store the proof
        doc = {
            "proof_id": proof_id,
            "proof_type": request.proof_type,
            "public_inputs": request.public_inputs,
            "proof": {
                "a": request.proof_a,
                "b": request.proof_b,
                "c": request.proof_c
            },
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.zkp_proofs.insert_one(doc)
        
        # Format check (basic validation)
        is_valid_format = (
            len(request.proof_a) == 2 and
            len(request.proof_b) == 2 and
            len(request.proof_c) == 2
        )
        
        if not is_valid_format:
            await db.zkp_proofs.update_one(
                {"proof_id": proof_id},
                {"$set": {"status": "invalid", "error": "Invalid proof format"}}
            )
            return {"proof_id": proof_id, "status": "invalid", "message": "Invalid proof format"}
        
        # Mark as format_verified (actual on-chain verification requires calling verifyProofView)
        await db.zkp_proofs.update_one(
            {"proof_id": proof_id},
            {"$set": {"status": "format_verified", "verified_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        return {
            "proof_id": proof_id,
            "status": "format_verified",
            "message": "Proof format valid. Call /zkp/verify-onchain to verify on-chain.",
            "verifier_contracts": ZKP_VERIFIER_ADDRESSES
        }
    except Exception as e:
        logger.error(f"ZKP proof submission error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/zkp/verify-onchain")
async def verify_proof_onchain(request: ZKPVerifyOnChainRequest):
    """Verify a ZKP proof using the on-chain verifier contract"""
    try:
        chain = request.chain
        if chain not in ZKP_VERIFIER_ADDRESSES:
            raise HTTPException(status_code=400, detail=f"Chain {chain} not supported")
        
        config = CHAIN_CONFIG.get(chain)
        if not config:
            raise HTTPException(status_code=400, detail=f"Chain {chain} not configured")
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        verifier_address = ZKP_VERIFIER_ADDRESSES[chain]
        verifier = w3.eth.contract(
            address=Web3.to_checksum_address(verifier_address),
            abi=ZKP_VERIFIER_ABI
        )
        
        # Convert proof to integers
        a = [int(x, 16) if x.startswith('0x') else int(x) for x in request.proof_a]
        b = [[int(x, 16) if x.startswith('0x') else int(x) for x in row] for row in request.proof_b]
        c = [int(x, 16) if x.startswith('0x') else int(x) for x in request.proof_c]
        inputs = [int(x, 16) if x.startswith('0x') else int(x) for x in request.public_inputs[:2]]
        
        # Pad inputs to 2 if needed
        while len(inputs) < 2:
            inputs.append(0)
        
        # Call view function to verify
        try:
            is_valid = verifier.functions.verifyProofView(a, b, c, inputs).call()
        except Exception as e:
            logger.warning(f"On-chain verification call failed: {e}")
            is_valid = False
        
        # Get verifier stats
        try:
            total, successful, rate = verifier.functions.getStats().call()
        except Exception:
            total, successful, rate = 0, 0, 0
        
        return {
            "chain": chain,
            "verifier_address": verifier_address,
            "is_valid": is_valid,
            "verification_type": "on-chain",
            "verifier_stats": {
                "total_verifications": total,
                "successful_verifications": successful,
                "success_rate": rate
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"On-chain verification error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/zkp/verifier-info/{chain}")
async def get_verifier_info(chain: str):
    """Get ZKP verifier contract info for a chain"""
    try:
        if chain not in ZKP_VERIFIER_ADDRESSES:
            raise HTTPException(status_code=400, detail=f"Chain {chain} not supported")
        
        config = CHAIN_CONFIG.get(chain)
        if not config:
            raise HTTPException(status_code=400, detail=f"Chain {chain} not configured")
        
        verifier_address = ZKP_VERIFIER_ADDRESSES[chain]
        
        try:
            w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
            verifier = w3.eth.contract(
                address=Web3.to_checksum_address(verifier_address),
                abi=ZKP_VERIFIER_ABI
            )
            total, successful, rate = verifier.functions.getStats().call()
        except Exception:
            total, successful, rate = 0, 0, 0
        
        return {
            "chain": chain,
            "verifier_address": verifier_address,
            "explorer_url": f"{config['explorer']}/address/{verifier_address}",
            "stats": {
                "total_verifications": total,
                "successful_verifications": successful,
                "success_rate": rate
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Verifier info error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/zkp/proof/{proof_id}")
async def get_zkp_proof(proof_id: str):
    """Get ZKP proof status"""
    try:
        proof = await db.zkp_proofs.find_one({"proof_id": proof_id}, {"_id": 0})
        if not proof:
            raise HTTPException(status_code=404, detail="Proof not found")
        return proof
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ZKP proof fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- 2. PRIVATE RELAYER ON-CHAIN ---
PRIVACY_RELAYER_ABI = [
    {"inputs":[{"name":"recipient","type":"address"},{"name":"ephemeralKey","type":"bytes32"},{"name":"viewTag","type":"uint8"}],"name":"relay","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[],"name":"feeBps","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"totalRelayed","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]

class RelayerTxRequest(BaseModel):
    from_address: str
    stealth_address: str
    amount_wei: str
    ephemeral_key: str
    view_tag: int
    chain: str = "base"

@api_router.post("/relayer/prepare-tx")
async def prepare_relayer_transaction(request: RelayerTxRequest):
    """Prepare a transaction to go through the on-chain PrivacyRelayer"""
    try:
        config = CHAIN_CONFIG.get(request.chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        relayer_address = "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        
        # Get current fee
        relayer = w3.eth.contract(address=Web3.to_checksum_address(relayer_address), abi=PRIVACY_RELAYER_ABI)
        try:
            fee_bps = relayer.functions.feeBps().call()
        except Exception:
            fee_bps = 5  # Default 0.05%
        
        amount = int(request.amount_wei)
        fee_amount = (amount * fee_bps) // 10000
        
        # Encode function call
        ephemeral_bytes = bytes.fromhex(request.ephemeral_key[2:] if request.ephemeral_key.startswith("0x") else request.ephemeral_key)
        ephemeral_bytes32 = ephemeral_bytes[:32].ljust(32, b'\x00')
        
        tx_data = relayer.encodeABI(
            fn_name="relay",
            args=[
                Web3.to_checksum_address(request.stealth_address),
                ephemeral_bytes32,
                request.view_tag
            ]
        )
        
        # Get gas estimate
        try:
            gas_estimate = w3.eth.estimate_gas({
                'to': relayer_address,
                'value': amount,
                'data': tx_data,
                'from': Web3.to_checksum_address(request.from_address)
            })
        except Exception:
            gas_estimate = 100000
        
        gas_price = w3.eth.gas_price
        
        return {
            "to": relayer_address,
            "value": str(amount),
            "data": tx_data,
            "gas": gas_estimate,
            "gasPrice": str(gas_price),
            "chain": request.chain,
            "chainId": config["chain_id"],
            "fee_bps": fee_bps,
            "fee_amount": str(fee_amount),
            "net_amount": str(amount - fee_amount),
            "relayer_contract": relayer_address
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relayer tx preparation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/relayer/stats/{chain}")
async def get_relayer_stats(chain: str):
    """Get on-chain relayer statistics"""
    try:
        config = CHAIN_CONFIG.get(chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        relayer_address = "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        relayer = w3.eth.contract(address=Web3.to_checksum_address(relayer_address), abi=PRIVACY_RELAYER_ABI)
        
        try:
            total_relayed = relayer.functions.totalRelayed().call()
            fee_bps = relayer.functions.feeBps().call()
        except Exception:
            total_relayed = 0
            fee_bps = 5
        
        return {
            "chain": chain,
            "relayer_address": relayer_address,
            "total_relayed_wei": str(total_relayed),
            "total_relayed": str(Web3.from_wei(total_relayed, 'ether')),
            "fee_bps": fee_bps,
            "fee_percentage": f"{fee_bps / 100}%"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relayer stats error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- 3. CROSS-CHAIN PRIVACY SPLITTING ---
class CrossChainSplitRequest(BaseModel):
    from_address: str
    total_amount_wei: str
    splits: List[Dict[str, Any]]  # [{"chain": "base", "stealth_address": "0x...", "percentage": 30}, ...]

@api_router.post("/split/prepare")
async def prepare_cross_chain_split(request: CrossChainSplitRequest):
    """Prepare a cross-chain privacy split transaction"""
    try:
        total = int(request.total_amount_wei)
        
        # Validate splits add up to 100%
        total_pct = sum(s.get("percentage", 0) for s in request.splits)
        if total_pct != 100:
            raise HTTPException(status_code=400, detail=f"Splits must total 100%, got {total_pct}%")
        
        split_id = str(uuid.uuid4())
        transactions = []
        
        for split in request.splits:
            chain = split["chain"]
            config = CHAIN_CONFIG.get(chain)
            if not config:
                raise HTTPException(status_code=400, detail=f"Invalid chain: {chain}")
            
            pct = split["percentage"]
            amount = (total * pct) // 100
            
            # Generate ephemeral key for this split
            ephemeral_key = "0x" + secrets.token_hex(32)
            view_tag = secrets.randbelow(256)
            
            transactions.append({
                "chain": chain,
                "chain_id": config["chain_id"],
                "stealth_address": split["stealth_address"],
                "amount_wei": str(amount),
                "amount": str(Web3.from_wei(amount, 'ether')),
                "percentage": pct,
                "ephemeral_key": ephemeral_key,
                "view_tag": view_tag,
                "relayer_contract": "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
                "status": "pending"
            })
        
        # Store the split plan
        doc = {
            "split_id": split_id,
            "from_address": request.from_address,
            "total_amount_wei": request.total_amount_wei,
            "transactions": transactions,
            "status": "prepared",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.cross_chain_splits.insert_one(doc)
        
        return {
            "split_id": split_id,
            "total_amount": str(Web3.from_wei(total, 'ether')),
            "num_chains": len(transactions),
            "transactions": transactions,
            "instructions": "Execute each transaction in sequence on the respective chains"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cross-chain split error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/split/update-status")
async def update_split_status(
    split_id: str = Body(...),
    chain: str = Body(...),
    tx_hash: str = Body(...),
    status: str = Body(...)
):
    """Update status of a split transaction"""
    try:
        result = await db.cross_chain_splits.update_one(
            {"split_id": split_id, "transactions.chain": chain},
            {"$set": {
                "transactions.$.tx_hash": tx_hash,
                "transactions.$.status": status,
                "transactions.$.completed_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        # Check if all transactions are complete
        split = await db.cross_chain_splits.find_one({"split_id": split_id})
        if split:
            all_complete = all(t.get("status") == "confirmed" for t in split.get("transactions", []))
            if all_complete:
                await db.cross_chain_splits.update_one(
                    {"split_id": split_id},
                    {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}}
                )
        
        return {"success": True, "split_id": split_id}
    except Exception as e:
        logger.error(f"Split status update error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/split/{split_id}")
async def get_split_status(split_id: str):
    """Get cross-chain split status"""
    try:
        split = await db.cross_chain_splits.find_one({"split_id": split_id}, {"_id": 0})
        if not split:
            raise HTTPException(status_code=404, detail="Split not found")
        return split
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Split fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# --- 4. ENCRYPTED MESSAGING (True E2E — ECIES / ECDH + AES-GCM) ---

class RegisterMessagingKeyRequest(BaseModel):
    address: str
    public_key: str  # Compressed secp256k1 hex (66 chars)

class E2EMessageRequest(BaseModel):
    sender_address: str
    recipient_address: str
    ciphertext: str       # Hex-encoded AES-GCM ciphertext (encrypted client-side)
    ephemeral_pub: str    # Hex-encoded ephemeral public key used for ECDH
    nonce: str            # Hex-encoded 12-byte GCM nonce
    chain: str = "base"
    attached_tx_hash: Optional[str] = None

# Legacy model kept for backwards compat — new clients use E2EMessageRequest
class EncryptedMessageRequest(BaseModel):
    sender_address: str
    recipient_address: str
    message: str
    recipient_public_key: str
    chain: str = "base"
    attached_tx_hash: Optional[str] = None

@api_router.post("/messaging/register-key")
async def register_messaging_key(request: RegisterMessagingKeyRequest):
    """Register a user's messaging public key (derived from wallet signature)."""
    try:
        await db.messaging_keys.update_one(
            {"address": request.address.lower()},
            {"$set": {
                "address": request.address.lower(),
                "public_key": request.public_key,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        return {"address": request.address, "registered": True}
    except Exception as e:
        logger.error(f"Register messaging key error: {e}")
        raise HTTPException(status_code=500, detail="Failed to register key")

@api_router.get("/messaging/pubkey/{address}")
async def get_messaging_pubkey(address: str):
    """Retrieve a user's messaging public key so others can encrypt messages for them."""
    try:
        doc = await db.messaging_keys.find_one(
            {"address": address.lower()},
            {"_id": 0}
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Recipient has not registered a messaging key yet")
        return {"address": address, "public_key": doc["public_key"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get messaging pubkey error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch key")

@api_router.post("/messaging/send-e2e")
async def send_e2e_message(request: E2EMessageRequest):
    """Store a pre-encrypted E2E message. Server NEVER sees plaintext."""
    try:
        message_id = str(uuid.uuid4())
        doc = {
            "message_id": message_id,
            "sender_address": request.sender_address.lower(),
            "recipient_address": request.recipient_address.lower(),
            "ciphertext": request.ciphertext,
            "ephemeral_pub": request.ephemeral_pub,
            "nonce": request.nonce,
            "chain": request.chain,
            "attached_tx_hash": request.attached_tx_hash,
            "e2e": True,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.encrypted_messages.insert_one(doc)
        return {"message_id": message_id, "recipient": request.recipient_address, "e2e": True}
    except Exception as e:
        logger.error(f"E2E message send error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/messaging/send")
async def send_encrypted_message(request: EncryptedMessageRequest):
    """Legacy send — server-side encryption fallback for non-E2E clients."""
    try:
        message_id = str(uuid.uuid4())
        # Normalize to lowercase for consistent decryption
        recipient_key = request.recipient_public_key.lower()
        key = hashlib.sha256(recipient_key.encode()).digest()
        iv = secrets.token_bytes(16)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        message_bytes = request.message.encode()
        padding_len = 16 - (len(message_bytes) % 16)
        padded_message = message_bytes + bytes([padding_len] * padding_len)
        encrypted = cipher.encrypt(padded_message)
        encrypted_b64 = base64.b64encode(iv + encrypted).decode()
        doc = {
            "message_id": message_id,
            "sender_address": request.sender_address.lower(),
            "recipient_address": request.recipient_address.lower(),
            "encrypted_content": encrypted_b64,
            "chain": request.chain,
            "attached_tx_hash": request.attached_tx_hash,
            "e2e": False,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.encrypted_messages.insert_one(doc)
        return {
            "message_id": message_id,
            "encrypted_content": encrypted_b64,
            "recipient": request.recipient_address,
            "attached_to_tx": request.attached_tx_hash
        }
    except Exception as e:
        logger.error(f"Encrypted message send error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/messaging/inbox/{address}")
async def get_encrypted_inbox(address: str, limit: int = 50):
    """Get encrypted messages for an address"""
    try:
        messages = await db.encrypted_messages.find(
            {"recipient_address": {"$regex": re.escape(address), "$options": "i"}},
            {"_id": 0}
        ).sort("created_at", -1).to_list(limit)
        
        unread_count = await db.encrypted_messages.count_documents({
            "recipient_address": {"$regex": re.escape(address), "$options": "i"},
            "read": False
        })
        
        return {
            "address": address,
            "messages": messages,
            "total_count": len(messages),
            "unread_count": unread_count
        }
    except Exception as e:
        logger.error(f"Inbox fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/messaging/decrypt")
async def decrypt_legacy_message(
    message_id: str = Body(...),
    recipient_address: str = Body(...)
):
    """Server-side decrypt for legacy (non-E2E) messages. E2E messages cannot be decrypted here."""
    try:
        msg = await db.encrypted_messages.find_one({"message_id": message_id}, {"_id": 0})
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        
        if msg.get("e2e"):
            raise HTTPException(status_code=400, detail="E2E messages can only be decrypted client-side")
        
        encrypted_b64 = msg.get("encrypted_content")
        if not encrypted_b64:
            raise HTTPException(status_code=400, detail="No encrypted content")
        
        # Try decrypting with the stored recipient_address (which was used as the key)
        stored_recipient = msg.get("recipient_address", "")
        key_candidates = [
            stored_recipient,
            stored_recipient.lower(),
            recipient_address,
            recipient_address.lower(),
        ]
        
        raw = base64.b64decode(encrypted_b64)
        iv = raw[:16]
        ct = raw[16:]
        
        plaintext = None
        for candidate in key_candidates:
            if not candidate:
                continue
            try:
                k = hashlib.sha256(candidate.encode()).digest()
                cipher = AES.new(k, AES.MODE_CBC, iv)
                decrypted = cipher.decrypt(ct)
                pad_len = decrypted[-1]
                if 1 <= pad_len <= 16 and all(b == pad_len for b in decrypted[-pad_len:]):
                    plaintext = decrypted[:-pad_len].decode('utf-8')
                    break
            except Exception:
                continue
        
        if plaintext is None:
            raise HTTPException(status_code=400, detail="Could not decrypt")
        
        # Mark as read
        await db.encrypted_messages.update_one(
            {"message_id": message_id},
            {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        return {"message_id": message_id, "plaintext": plaintext, "sender": msg["sender_address"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Message decryption error: {e}")
        raise HTTPException(status_code=500, detail="Decryption failed")

# --- 5. MULTISIG PRIVACY ---
class MultisigCreateRequest(BaseModel):
    name: str
    owners: List[str]  # List of owner addresses
    threshold: int  # Required signatures
    chain: str = "base"

class MultisigSignRequest(BaseModel):
    multisig_id: str
    proposal_id: str
    signer_address: str
    signature: str

@api_router.post("/multisig/create")
async def create_multisig_wallet(request: MultisigCreateRequest):
    """Create a privacy-focused multisig wallet"""
    try:
        if request.threshold > len(request.owners):
            raise HTTPException(status_code=400, detail="Threshold cannot exceed number of owners")
        if request.threshold < 1:
            raise HTTPException(status_code=400, detail="Threshold must be at least 1")
        
        multisig_id = str(uuid.uuid4())
        
        # Generate a shared stealth meta-address for the multisig
        shared_spend_key = "0x" + secrets.token_hex(32)
        shared_view_key = "0x" + secrets.token_hex(32)
        
        doc = {
            "multisig_id": multisig_id,
            "name": request.name,
            "owners": request.owners,
            "threshold": request.threshold,
            "chain": request.chain,
            "shared_spend_key": shared_spend_key,
            "shared_view_key": shared_view_key,
            "proposals": [],
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.multisig_wallets.insert_one(doc)
        
        return {
            "multisig_id": multisig_id,
            "name": request.name,
            "owners": request.owners,
            "threshold": request.threshold,
            "chain": request.chain,
            "message": f"Multisig created: {request.threshold} of {len(request.owners)} signatures required"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Multisig creation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/multisig/propose")
async def propose_multisig_transaction(
    multisig_id: str = Body(...),
    proposer: str = Body(...),
    to_address: str = Body(...),
    amount_wei: str = Body(...),
    description: str = Body(default="")
):
    """Propose a transaction for multisig approval"""
    try:
        multisig = await db.multisig_wallets.find_one({"multisig_id": multisig_id})
        if not multisig:
            raise HTTPException(status_code=404, detail="Multisig not found")
        
        if proposer.lower() not in [o.lower() for o in multisig["owners"]]:
            raise HTTPException(status_code=403, detail="Not an owner of this multisig")
        
        proposal_id = str(uuid.uuid4())
        proposal = {
            "proposal_id": proposal_id,
            "proposer": proposer,
            "to_address": to_address,
            "amount_wei": amount_wei,
            "description": description,
            "signatures": [],
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.multisig_wallets.update_one(
            {"multisig_id": multisig_id},
            {"$push": {"proposals": proposal}}
        )
        
        return {
            "proposal_id": proposal_id,
            "multisig_id": multisig_id,
            "to_address": to_address,
            "amount": str(Web3.from_wei(int(amount_wei), 'ether')),
            "threshold": multisig["threshold"],
            "signatures_needed": multisig["threshold"],
            "status": "pending"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Multisig proposal error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/multisig/sign")
async def sign_multisig_proposal(request: MultisigSignRequest):
    """Sign a multisig proposal"""
    try:
        multisig = await db.multisig_wallets.find_one({"multisig_id": request.multisig_id})
        if not multisig:
            raise HTTPException(status_code=404, detail="Multisig not found")
        
        if request.signer_address.lower() not in [o.lower() for o in multisig["owners"]]:
            raise HTTPException(status_code=403, detail="Not an owner of this multisig")
        
        # Find the proposal
        proposal = next((p for p in multisig.get("proposals", []) if p["proposal_id"] == request.proposal_id), None)
        if not proposal:
            raise HTTPException(status_code=404, detail="Proposal not found")
        
        # Check if already signed
        if any(s["signer"].lower() == request.signer_address.lower() for s in proposal.get("signatures", [])):
            raise HTTPException(status_code=400, detail="Already signed this proposal")
        
        # Add signature
        signature_entry = {
            "signer": request.signer_address,
            "signature": request.signature,
            "signed_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.multisig_wallets.update_one(
            {"multisig_id": request.multisig_id, "proposals.proposal_id": request.proposal_id},
            {"$push": {"proposals.$.signatures": signature_entry}}
        )
        
        # Check if threshold reached
        new_sig_count = len(proposal.get("signatures", [])) + 1
        threshold_reached = new_sig_count >= multisig["threshold"]
        
        if threshold_reached:
            await db.multisig_wallets.update_one(
                {"multisig_id": request.multisig_id, "proposals.proposal_id": request.proposal_id},
                {"$set": {"proposals.$.status": "ready_to_execute"}}
            )
        
        return {
            "proposal_id": request.proposal_id,
            "signer": request.signer_address,
            "signatures_count": new_sig_count,
            "threshold": multisig["threshold"],
            "threshold_reached": threshold_reached,
            "status": "ready_to_execute" if threshold_reached else "pending"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Multisig sign error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/multisig/{multisig_id}")
async def get_multisig(multisig_id: str):
    """Get multisig wallet details"""
    try:
        multisig = await db.multisig_wallets.find_one({"multisig_id": multisig_id}, {"_id": 0})
        if not multisig:
            raise HTTPException(status_code=404, detail="Multisig not found")
        return multisig
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Multisig fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/multisig/user/{address}")
async def get_user_multisigs(address: str):
    """Get all multisigs where user is an owner"""
    try:
        multisigs = await db.multisig_wallets.find(
            {"owners": {"$regex": re.escape(address), "$options": "i"}},
            {"_id": 0}
        ).to_list(100)
        
        return {
            "address": address,
            "multisigs": multisigs,
            "count": len(multisigs)
        }
    except Exception as e:
        logger.error(f"User multisigs fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

# ─── Developer API: API Key Management ─────────────────────────────────────────

class APIKeyCreate(BaseModel):
    name: str
    description: Optional[str] = None
    rate_limit: int = 100  # requests per minute
    allowed_endpoints: List[str] = ["*"]

class APIKeyResponse(BaseModel):
    api_key: str
    name: str
    created_at: str
    rate_limit: int

# In-memory rate limiting (for production, use Redis)
rate_limit_store: Dict[str, Dict[str, Any]] = {}

async def check_rate_limit(api_key: str, limit: int = 100) -> bool:
    """Check if request is within rate limit"""
    now = datetime.now(timezone.utc)
    minute_key = now.strftime("%Y-%m-%d-%H-%M")
    
    if api_key not in rate_limit_store:
        rate_limit_store[api_key] = {}
    
    if minute_key not in rate_limit_store[api_key]:
        rate_limit_store[api_key] = {minute_key: 1}
        return True
    
    if rate_limit_store[api_key][minute_key] >= limit:
        return False
    
    rate_limit_store[api_key][minute_key] += 1
    return True

@api_router.post("/developer/keys/create")
async def create_api_key(request: APIKeyCreate, owner_address: str = Body(...)):
    """Create a new API key for developer access"""
    try:
        # Generate secure API key
        api_key = f"upl_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        
        doc = {
            "key_hash": key_hash,
            "name": request.name,
            "description": request.description,
            "owner": owner_address.lower(),
            "rate_limit": request.rate_limit,
            "allowed_endpoints": request.allowed_endpoints,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "active": True,
            "usage_count": 0,
            "last_used": None
        }
        
        await db.api_keys.insert_one(doc)
        
        return {
            "api_key": api_key,  # Only returned once!
            "name": request.name,
            "rate_limit": request.rate_limit,
            "message": "Save this API key securely - it won't be shown again!"
        }
    except Exception as e:
        logger.error(f"API key creation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/developer/keys/{owner_address}")
async def list_api_keys(owner_address: str):
    """List all API keys for an address (without revealing the actual keys)"""
    try:
        keys = await db.api_keys.find(
            {"owner": owner_address.lower()},
            {"_id": 0, "key_hash": 0}
        ).to_list(100)
        
        return {"keys": keys, "count": len(keys)}
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.delete("/developer/keys/{key_name}")
async def revoke_api_key(key_name: str, owner_address: str = Body(...)):
    """Revoke an API key"""
    try:
        result = await db.api_keys.update_one(
            {"name": key_name, "owner": owner_address.lower()},
            {"$set": {"active": False, "revoked_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="API key not found")
        
        return {"success": True, "message": f"API key '{key_name}' revoked"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/developer/usage/{owner_address}")
async def get_api_usage(owner_address: str):
    """Get API usage statistics"""
    try:
        keys = await db.api_keys.find(
            {"owner": owner_address.lower()},
            {"_id": 0}
        ).to_list(100)
        
        total_usage = sum(k.get("usage_count", 0) for k in keys)
        
        return {
            "total_requests": total_usage,
            "keys": [{
                "name": k["name"],
                "usage_count": k.get("usage_count", 0),
                "last_used": k.get("last_used"),
                "rate_limit": k.get("rate_limit", 100),
                "active": k.get("active", True)
            } for k in keys]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal error occurred")

# Public API endpoints (for developers)
@api_router.get("/v1/chains")
async def public_get_chains(api_key: str = None):
    """[Public API] Get list of supported chains"""
    if api_key:
        key_doc = await db.api_keys.find_one({"key_hash": hashlib.sha256(api_key.encode()).hexdigest()})
        if key_doc and key_doc.get("active"):
            if not await check_rate_limit(api_key, key_doc.get("rate_limit", 100)):
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            await db.api_keys.update_one(
                {"key_hash": hashlib.sha256(api_key.encode()).hexdigest()},
                {"$inc": {"usage_count": 1}, "$set": {"last_used": datetime.now(timezone.utc).isoformat()}}
            )
    
    return {
        "chains": [
            {"id": k, "name": v["name"], "chain_id": v["chain_id"], "live": True}
            for k, v in CHAIN_CONFIG.items()
        ],
        "total": len(CHAIN_CONFIG)
    }

@api_router.post("/v1/stealth/generate")
async def public_generate_stealth(
    spending_key: str = Body(...),
    viewing_key: str = Body(...),
    api_key: str = Body(None)
):
    """[Public API] Generate stealth address"""
    if api_key:
        key_doc = await db.api_keys.find_one({"key_hash": hashlib.sha256(api_key.encode()).hexdigest()})
        if key_doc and key_doc.get("active"):
            if not await check_rate_limit(api_key, key_doc.get("rate_limit", 100)):
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            await db.api_keys.update_one(
                {"key_hash": hashlib.sha256(api_key.encode()).hexdigest()},
                {"$inc": {"usage_count": 1}, "$set": {"last_used": datetime.now(timezone.utc).isoformat()}}
            )
    
    try:
        Account.enable_unaudited_hdwallet_features()
        ephemeral = Account.create()
        
        combined = hashlib.sha256(
            bytes.fromhex(ephemeral.key.hex()[2:]) + 
            bytes.fromhex(spending_key[2:] if spending_key.startswith("0x") else spending_key)
        ).digest()
        
        stealth_private = keys.PrivateKey(combined)
        stealth_address = stealth_private.public_key.to_checksum_address()
        
        view_tag = hashlib.sha256(
            bytes.fromhex(viewing_key[2:] if viewing_key.startswith("0x") else viewing_key) +
            bytes.fromhex(ephemeral.key.hex()[2:])
        ).hexdigest()[:8]
        
        return {
            "stealth_address": stealth_address,
            "ephemeral_public_key": ephemeral.address,
            "view_tag": f"0x{view_tag}",
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "algorithm": "secp256k1-sha256"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail="An internal error occurred")

@api_router.get("/v1/docs")
async def get_api_documentation():
    """Get API documentation"""
    return {
        "version": "1.0.0",
        "base_url": "/api/v1",
        "authentication": {
            "type": "API Key",
            "header": "X-API-Key or api_key body parameter",
            "obtain": "POST /api/developer/keys/create"
        },
        "rate_limits": {
            "default": "100 requests/minute",
            "custom": "Set during key creation"
        },
        "endpoints": [
            {
                "method": "GET",
                "path": "/v1/chains",
                "description": "List all supported chains",
                "auth_required": False
            },
            {
                "method": "POST",
                "path": "/v1/stealth/generate",
                "description": "Generate a stealth address",
                "auth_required": False,
                "body": {
                    "spending_key": "hex string - public spending key",
                    "viewing_key": "hex string - public viewing key"
                }
            },
            {
                "method": "POST",
                "path": "/v1/split/prepare",
                "description": "Prepare cross-chain split transaction",
                "auth_required": True,
                "body": {
                    "from_address": "sender address",
                    "total_amount_wei": "total amount in wei",
                    "splits": [{"chain": "base", "stealth_address": "0x...", "percentage": 50}]
                }
            },
            {
                "method": "POST",
                "path": "/v1/receipt/create",
                "description": "Create encrypted transaction receipt",
                "auth_required": True
            },
            {
                "method": "GET",
                "path": "/v1/balance/{address}",
                "description": "Get address balance across chains",
                "auth_required": False
            }
        ],
        "sdk": {
            "javascript": "npm install @upl/sdk",
            "python": "pip install upl-sdk",
            "note": "SDKs coming soon"
        },
        "support": {
            "docs": "https://docs.privacycloak.in",
            "github": "https://github.com/upl-protocol"
        }
    }

# ===================== DEFI INTEGRATIONS (Privacy-Routed) =====================

# ─── Uniswap V3 Integration ───────────────────────────────────────────────────

# Uniswap V3 Router & Quoter addresses per chain
UNISWAP_V3_CONTRACTS = {
    "base": {
        "router": "0x2626664c2603336E57B271c5C0b26F421741e481",
        "quoter": "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"
    },
    "arbitrum": {
        "router": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "quoter": "0x727C2f4f6CAD707Aa59E6c6832db58F311b4925c"
    },
    "polygon": {
        "router": "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        "quoter": "0x61fFE014bA17989E8aBf5fF3A87B8203A0dFd3Af"
    },
    "optimism": {
        "router": "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        "quoter": "0x61fFE014bA17989E8aBf5fF3A87B8203A0dFd3Af"
    }
}

UNISWAP_QUOTER_ABI = [
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "fee", "type": "uint24"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "sqrtPriceLimitX96", "type": "uint160"}
        ],
        "name": "quoteExactInputSingle",
        "outputs": [{"name": "amountOut", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

class UniswapPrivateSwapRequest(BaseModel):
    chain: str = "base"
    token_in: str  # token symbol or address
    token_out: str  # token symbol or address
    amount_in: str  # human readable amount e.g. "0.1"
    stealth_recipient: str  # the stealth address to receive output
    fee_tier: str = "medium"  # very_low/low/medium/high

FEE_TIERS = {"very_low": 100, "low": 500, "medium": 3000, "high": 10000}

@api_router.post("/uniswap/quote")
async def uniswap_private_quote(request: UniswapPrivateSwapRequest):
    """Get a Uniswap V3 quote routed through the privacy layer"""
    try:
        if request.chain not in CHAIN_CONFIG:
            raise HTTPException(status_code=400, detail="Unsupported chain")
        if request.chain not in UNISWAP_V3_CONTRACTS:
            raise HTTPException(status_code=400, detail=f"Uniswap not available on {request.chain}")

        config = CHAIN_CONFIG[request.chain]
        contracts = UNISWAP_V3_CONTRACTS[request.chain]
        fee = FEE_TIERS.get(request.fee_tier, 3000)

        # Resolve token addresses
        chain_tokens = TOKENS.get(request.chain, {})

        def resolve_address(symbol_or_addr: str) -> str:
            if symbol_or_addr.startswith("0x"):
                return Web3.to_checksum_address(symbol_or_addr)
            if symbol_or_addr.upper() in chain_tokens:
                addr = chain_tokens[symbol_or_addr.upper()]["address"]
                if addr == "native":
                    return Web3.to_checksum_address(config["weth"])
                return Web3.to_checksum_address(addr)
            # fallback: treat as native -> wrap
            return Web3.to_checksum_address(config["weth"])

        token_in_addr = resolve_address(request.token_in)
        token_out_addr = resolve_address(request.token_out)

        # Determine decimals for amount parsing
        def get_decimals(symbol_or_addr: str) -> int:
            if symbol_or_addr.upper() in chain_tokens:
                return chain_tokens[symbol_or_addr.upper()]["decimals"]
            return 18

        decimals_in = get_decimals(request.token_in)
        amount_in_wei = int(float(request.amount_in) * (10 ** decimals_in))

        # Try on-chain quote
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        quoter = w3.eth.contract(
            address=Web3.to_checksum_address(contracts["quoter"]),
            abi=UNISWAP_QUOTER_ABI
        )

        try:
            amount_out = quoter.functions.quoteExactInputSingle(
                token_in_addr, token_out_addr, fee, amount_in_wei, 0
            ).call()
            quote_source = "on_chain"
        except Exception as e:
            logger.warning(f"Uniswap on-chain quote failed: {e}, trying price oracle fallback")
            # DeFiLlama price oracle fallback (free, no rate limits)
            try:
                # Common token addresses for price lookup
                TOKEN_ADDRESSES = {
                    "ETH": "ethereum:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    "WETH": "ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                    "USDC": "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                    "USDT": "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7",
                    "DAI": "ethereum:0x6B175474E89094C44Da98b954EedeAC495271d0F",
                    "MATIC": "polygon:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    "POL": "polygon:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                }
                token_key_in = TOKEN_ADDRESSES.get(request.token_in.upper(), TOKEN_ADDRESSES["ETH"])
                token_key_out = TOKEN_ADDRESSES.get(request.token_out.upper(), TOKEN_ADDRESSES["USDC"])
                async with httpx.AsyncClient(timeout=6.0) as client:
                    llama = await client.get(
                        f"https://coins.llama.fi/prices/current/{token_key_in},{token_key_out}"
                    )
                    prices = llama.json().get("coins", {})
                price_in = prices.get(token_key_in, {}).get("price", 1.0)
                price_out = prices.get(token_key_out, {}).get("price", 1.0)
                amount_in_float = float(request.amount_in)
                amount_in_usd = amount_in_float * price_in
                decimals_out_fb = get_decimals(request.token_out)
                amount_out_float = (amount_in_usd / price_out) if price_out > 0 else amount_in_float
                amount_out = int(amount_out_float * (10 ** decimals_out_fb))
                quote_source = "defillama_oracle"
            except Exception as oracle_err:
                logger.warning(f"DeFiLlama fallback failed: {oracle_err}, using 1:1 estimate")
                decimals_out_fallback = get_decimals(request.token_out)
                amount_in_float = float(request.amount_in)
                amount_out = int(amount_in_float * (10 ** decimals_out_fallback))
                quote_source = "estimated_1to1"

        privacy_fee_wei = amount_out * 5 // 10000
        amount_out_after_fee = amount_out - privacy_fee_wei

        decimals_out = get_decimals(request.token_out)
        amount_out_human = amount_out_after_fee / (10 ** decimals_out)

        return {
            "chain": request.chain,
            "token_in": request.token_in,
            "token_out": request.token_out,
            "amount_in": request.amount_in,
            "amount_in_wei": str(amount_in_wei),
            "amount_out_wei": str(amount_out),
            "amount_out_after_privacy_fee": str(amount_out_after_fee),
            "amount_out_human": f"{amount_out_human:.6f}",
            "privacy_fee_wei": str(privacy_fee_wei),
            "privacy_fee_pct": "0.05%",
            "fee_tier": request.fee_tier,
            "fee_bps": fee,
            "router": contracts["router"],
            "stealth_recipient": request.stealth_recipient,
            "privacy_layer": "enabled",
            "routing": "privacy_relayer → uniswap_v3 → stealth_address",
            "quote_source": quote_source
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Uniswap quote error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/uniswap/record-swap")
async def uniswap_record_private_swap(
    tx_hash: str = Body(...),
    from_address: str = Body(...),
    token_in: str = Body(...),
    token_out: str = Body(...),
    amount_in: str = Body(...),
    amount_out: str = Body(...),
    chain: str = Body(...),
    stealth_recipient: str = Body(...),
    router_used: str = Body(default="uniswap_v3")
):
    """Record a privacy-routed Uniswap swap"""
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
            "stealth_recipient": stealth_recipient,
            "router_used": router_used,
            "tx_type": "private_uniswap_swap",
            "privacy_layer": "enabled",
            "status": "confirmed",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.transactions.insert_one(doc)
        return {"success": True, "swap_id": doc["id"]}
    except Exception as e:
        logger.error(f"Uniswap swap record error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/uniswap/supported-chains")
async def uniswap_supported_chains():
    """Get chains where Uniswap V3 is available"""
    return {
        "chains": list(UNISWAP_V3_CONTRACTS.keys()),
        "contracts": UNISWAP_V3_CONTRACTS,
        "note": "All swaps routed through UPL privacy relayer"
    }


# ─── Hyperliquid Integration ──────────────────────────────────────────────────

# Hyperliquid L1 API base (their off-chain info endpoint)
HYPERLIQUID_API = "https://api.hyperliquid.xyz/info"
HYPERLIQUID_EXCHANGE_API = "https://api.hyperliquid.xyz/exchange"

# Common perp pairs on Hyperliquid
HYPERLIQUID_PERPS = [
    "BTC", "ETH", "SOL", "ARB", "OP", "AVAX", "MATIC",
    "DOGE", "LTC", "LINK", "UNI", "AAVE", "HYPE"
]

class HyperliquidPrivateOrderRequest(BaseModel):
    trader_address: str
    asset: str = "ETH"
    is_buy: bool = True
    size: float  # in USD notional
    limit_price: Optional[float] = None  # None for market order
    leverage: int = 1
    chain: str = "arbitrum"  # For routing the margin through privacy layer

@api_router.get("/hyperliquid/markets")
async def get_hyperliquid_markets():
    """Get available perpetual markets on Hyperliquid"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(HYPERLIQUID_API, json={"type": "meta"})
            if resp.status_code == 200:
                data = resp.json()
                universes = data.get("universe", [])
                markets = [
                    {
                        "name": u.get("name"),
                        "szDecimals": u.get("szDecimals"),
                        "maxLeverage": u.get("maxLeverage", 50),
                        "onlyIsolated": u.get("onlyIsolated", False)
                    }
                    for u in universes
                ]
                return {"markets": markets, "count": len(markets)}
            else:
                return {"markets": [{"name": p, "maxLeverage": 50} for p in HYPERLIQUID_PERPS], "count": len(HYPERLIQUID_PERPS)}
    except Exception as e:
        logger.warning(f"Hyperliquid markets fetch failed: {e}")
        return {"markets": [{"name": p, "maxLeverage": 50} for p in HYPERLIQUID_PERPS], "count": len(HYPERLIQUID_PERPS)}

@api_router.get("/hyperliquid/price/{asset}")
async def get_hyperliquid_price(asset: str):
    """Get current mark price for an asset on Hyperliquid"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(HYPERLIQUID_API, json={"type": "allMids"})
            if resp.status_code == 200:
                mids = resp.json()
                price = mids.get(asset.upper())
                if price:
                    return {"asset": asset.upper(), "price": float(price), "source": "hyperliquid"}
                return {"asset": asset.upper(), "price": None, "error": "Asset not found"}
            return {"asset": asset.upper(), "price": None, "error": "API unavailable"}
    except Exception as e:
        return {"asset": asset.upper(), "price": None, "error": str(e)}

@api_router.post("/hyperliquid/prepare-private-trade")
async def prepare_hyperliquid_private_trade(request: HyperliquidPrivateOrderRequest):
    """
    Prepare a privacy-routed trade on Hyperliquid.
    The margin is routed through a stealth address before depositing into Hyperliquid.
    """
    try:
        # Generate a privacy proxy address for this trade
        proxy_key = secrets.token_bytes(32)
        proxy_account = Account.from_key(proxy_key)

        trade_id = str(uuid.uuid4())

        # Generate stealth ephemeral key
        ephemeral_key = "0x" + secrets.token_hex(32)
        view_tag = secrets.randbelow(256)

        # Calculate fees
        privacy_fee_pct = 0.0005  # 0.05%
        usd_value = request.size
        privacy_fee_usd = usd_value * privacy_fee_pct

        doc = {
            "trade_id": trade_id,
            "trader_address": request.trader_address,
            "proxy_address": proxy_account.address,
            "asset": request.asset.upper(),
            "is_buy": request.is_buy,
            "size_usd": usd_value,
            "leverage": request.leverage,
            "limit_price": request.limit_price,
            "chain": request.chain,
            "ephemeral_key": ephemeral_key,
            "view_tag": view_tag,
            "privacy_fee_usd": privacy_fee_usd,
            "status": "pending",
            "platform": "hyperliquid",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.defi_trades.insert_one(doc)

        return {
            "trade_id": trade_id,
            "proxy_address": proxy_account.address,
            "platform": "hyperliquid",
            "asset": request.asset.upper(),
            "direction": "LONG" if request.is_buy else "SHORT",
            "size_usd": usd_value,
            "leverage": request.leverage,
            "privacy_fee_usd": privacy_fee_usd,
            "routing": f"your_wallet → stealth_proxy({proxy_account.address[:10]}...) → hyperliquid",
            "instructions": [
                f"1. Your identity is hidden via stealth proxy: {proxy_account.address}",
                f"2. Transfer margin (USDC) to proxy address on {request.chain}",
                f"3. Proxy deposits to Hyperliquid and opens {request.asset.upper()} {'LONG' if request.is_buy else 'SHORT'}",
                f"4. Privacy fee: ${privacy_fee_usd:.4f} (0.05%)"
            ],
            "ephemeral_key": ephemeral_key,
            "status": "prepared"
        }
    except Exception as e:
        logger.error(f"Hyperliquid trade preparation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/hyperliquid/record-trade")
async def record_hyperliquid_trade(
    trade_id: str = Body(...),
    tx_hash: str = Body(...),
    status: str = Body(default="submitted")
):
    """Record execution of a Hyperliquid private trade"""
    try:
        await db.defi_trades.update_one(
            {"trade_id": trade_id},
            {"$set": {
                "tx_hash": tx_hash,
                "status": status,
                "executed_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        # Also record in transactions
        trade = await db.defi_trades.find_one({"trade_id": trade_id}, {"_id": 0})
        if trade:
            await db.transactions.insert_one({
                "id": str(uuid.uuid4()),
                "tx_hash": tx_hash,
                "from_address": trade.get("trader_address", ""),
                "to_address": trade.get("proxy_address", ""),
                "amount_wei": "0",
                "chain": trade.get("chain", "arbitrum"),
                "tx_type": "private_hyperliquid_trade",
                "platform": "hyperliquid",
                "asset": trade.get("asset"),
                "direction": "LONG" if trade.get("is_buy") else "SHORT",
                "status": status,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        return {"success": True, "trade_id": trade_id}
    except Exception as e:
        logger.error(f"Hyperliquid trade record error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/hyperliquid/trades/{address}")
async def get_hyperliquid_trades(address: str):
    """Get all private Hyperliquid trades for an address"""
    try:
        trades = await db.defi_trades.find(
            {"trader_address": {"$regex": re.escape(address), "$options": "i"}, "platform": "hyperliquid"},
            {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        return {"trades": trades, "count": len(trades)}
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ─── Polymarket Integration ───────────────────────────────────────────────────

POLYMARKET_CLOB_API = "https://clob.polymarket.com"

class PolymarketPrivateBetRequest(BaseModel):
    bettor_address: str
    condition_id: str  # Polymarket market condition ID
    token_id: str  # YES or NO token ID
    outcome: str  # "YES" or "NO"
    amount_usdc: float  # Amount in USDC
    chain: str = "polygon"  # Polymarket runs on Polygon

@api_router.get("/polymarket/markets")
async def get_polymarket_markets(limit: int = 10):
    """Get active prediction markets from Polymarket"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{POLYMARKET_CLOB_API}/markets",
                params={"active": True, "limit": limit},
                headers={"Accept": "application/json"}
            )
            if resp.status_code == 200:
                data = resp.json()
                markets = data if isinstance(data, list) else data.get("data", [])
                return {
                    "markets": markets[:limit],
                    "count": len(markets[:limit]),
                    "source": "polymarket_clob"
                }
            raise HTTPException(status_code=502, detail="Polymarket API returned non-200 status")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Polymarket market fetch failed: {e}")
        raise HTTPException(status_code=503, detail="Polymarket API is currently unreachable. Try again later.")

@api_router.post("/polymarket/prepare-private-bet")
async def prepare_polymarket_private_bet(request: PolymarketPrivateBetRequest):
    """
    Prepare a privacy-routed bet on Polymarket.
    The USDC is routed through a stealth address before betting.
    """
    try:
        # Generate a privacy proxy address
        proxy_key = secrets.token_bytes(32)
        proxy_account = Account.from_key(proxy_key)

        bet_id = str(uuid.uuid4())

        # Privacy fee
        privacy_fee_pct = 0.0005
        privacy_fee_usdc = request.amount_usdc * privacy_fee_pct
        net_bet = request.amount_usdc - privacy_fee_usdc

        # Potential payout (estimated based on outcome)
        payout_multiplier = 1.0 / 0.65 if request.outcome.upper() == "YES" else 1.0 / 0.35
        estimated_payout = net_bet * payout_multiplier

        doc = {
            "bet_id": bet_id,
            "bettor_address": request.bettor_address,
            "proxy_address": proxy_account.address,
            "condition_id": request.condition_id,
            "token_id": request.token_id,
            "outcome": request.outcome.upper(),
            "amount_usdc": request.amount_usdc,
            "net_bet_usdc": net_bet,
            "privacy_fee_usdc": privacy_fee_usdc,
            "chain": request.chain,
            "platform": "polymarket",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.defi_trades.insert_one(doc)

        return {
            "bet_id": bet_id,
            "proxy_address": proxy_account.address,
            "platform": "polymarket",
            "condition_id": request.condition_id,
            "outcome": request.outcome.upper(),
            "amount_usdc": request.amount_usdc,
            "net_bet_usdc": net_bet,
            "privacy_fee_usdc": privacy_fee_usdc,
            "estimated_payout_if_win": f"${estimated_payout:.2f}",
            "routing": f"your_wallet → stealth_proxy({proxy_account.address[:10]}...) → polymarket",
            "instructions": [
                f"1. Your identity is hidden via stealth proxy: {proxy_account.address}",
                f"2. Transfer ${request.amount_usdc:.2f} USDC to proxy on Polygon",
                f"3. Proxy places {request.outcome.upper()} bet on condition {request.condition_id[:12]}...",
                f"4. Privacy fee: ${privacy_fee_usdc:.4f} USDC (0.05%)"
            ],
            "status": "prepared"
        }
    except Exception as e:
        logger.error(f"Polymarket bet preparation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/polymarket/record-bet")
async def record_polymarket_bet(
    bet_id: str = Body(...),
    tx_hash: str = Body(...),
    status: str = Body(default="submitted")
):
    """Record execution of a Polymarket private bet"""
    try:
        await db.defi_trades.update_one(
            {"bet_id": bet_id},
            {"$set": {
                "tx_hash": tx_hash,
                "status": status,
                "executed_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        bet = await db.defi_trades.find_one({"bet_id": bet_id}, {"_id": 0})
        if bet:
            await db.transactions.insert_one({
                "id": str(uuid.uuid4()),
                "tx_hash": tx_hash,
                "from_address": bet.get("bettor_address", ""),
                "to_address": bet.get("proxy_address", ""),
                "amount_wei": str(int(bet.get("amount_usdc", 0) * 1e6)),
                "chain": bet.get("chain", "polygon"),
                "tx_type": "private_polymarket_bet",
                "platform": "polymarket",
                "outcome": bet.get("outcome"),
                "status": status,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        return {"success": True, "bet_id": bet_id}
    except Exception as e:
        logger.error(f"Polymarket bet record error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/polymarket/bets/{address}")
async def get_polymarket_bets(address: str):
    """Get all private Polymarket bets for an address"""
    try:
        bets = await db.defi_trades.find(
            {"bettor_address": {"$regex": re.escape(address), "$options": "i"}, "platform": "polymarket"},
            {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        return {"bets": bets, "count": len(bets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ─── Error Monitoring Endpoint ─────────────────────────────────────────────────

@api_router.post("/errors/log")
async def log_frontend_error(error: Dict[str, Any] = Body(...)):
    """Log frontend errors for monitoring"""
    try:
        await db.error_logs.insert_one({
            **error,
            "logged_at": datetime.now(timezone.utc).isoformat()
        })
        return {"logged": True}
    except Exception:
        return {"logged": False}

@api_router.get("/errors/recent")
async def get_recent_errors(limit: int = 50, token: str = ""):
    """Get recent errors — admin token required"""
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if not admin_token or token != admin_token:
        raise HTTPException(status_code=403, detail="Forbidden")
    errors = await db.error_logs.find({}, {"_id": 0}).sort("logged_at", -1).limit(min(limit, 100)).to_list(min(limit, 100))
    return {"errors": errors, "count": len(errors)}

# ═══════════════════════════════════════════════════════════════════════════════
# STEALTH FULL FLOW — Meta-addresses, Announcements, Scanning
# ═══════════════════════════════════════════════════════════════════════════════

class MetaAddressRegister(BaseModel):
    wallet_address: str
    spend_pub: str       # compressed 33-byte hex pubkey
    view_pub: str        # compressed 33-byte hex pubkey
    meta_address: str    # st:eth:0x<spend><view>
    chain: str = "all"

class StealthAnnouncement(BaseModel):
    sender_address: str
    stealth_address: str
    ephemeral_pub: str   # compressed 33-byte hex
    view_tag: str        # 1 byte hex (2 chars)
    amount_wei: str      # string to avoid int overflow
    chain: str
    tx_hash: str = ""

@api_router.post("/stealth/meta/register")
async def register_meta_address(request: MetaAddressRegister):
    """Register or update a stealth meta-address for a wallet."""
    doc = {
        "wallet_address": request.wallet_address.lower(),
        "spend_pub": request.spend_pub,
        "view_pub": request.view_pub,
        "meta_address": request.meta_address,
        "chain": request.chain,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stealth_meta.update_one(
        {"wallet_address": request.wallet_address.lower()},
        {"$set": doc},
        upsert=True
    )
    return {"registered": True, "meta_address": request.meta_address}

@api_router.get("/stealth/meta/{wallet_address}")
async def get_meta_address(wallet_address: str):
    """Get stealth meta-address for a wallet."""
    doc = await db.stealth_meta.find_one(
        {"wallet_address": wallet_address.lower()}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No meta-address registered")
    return doc

@api_router.post("/stealth/announce")
async def post_announcement(request: StealthAnnouncement):
    """Post a stealth announcement after sending. Acts as the off-chain relay."""
    doc = {
        "announcement_id": str(uuid.uuid4()),
        "sender_address": request.sender_address,
        "stealth_address": request.stealth_address,
        "ephemeral_pub": request.ephemeral_pub,
        "view_tag": request.view_tag,
        "amount_wei": request.amount_wei,
        "chain": request.chain,
        "tx_hash": request.tx_hash,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stealth_announcements.insert_one(doc)
    return {"announced": True, "announcement_id": doc["announcement_id"]}

@api_router.get("/stealth/announcements")
async def get_announcements(chain: str = "all", limit: int = 500):
    """Get all stealth announcements for scanning. Recipients scan these to find their payments."""
    query = {} if chain == "all" else {"chain": chain}
    docs = await db.stealth_announcements.find(
        query, {"_id": 0}
    ).sort("created_at", -1).limit(min(limit, 1000)).to_list(min(limit, 1000))
    return {"announcements": docs, "count": len(docs)}

@api_router.post("/stealth/check-balance")
async def check_stealth_balance(addresses: List[str] = Body(..., embed=True), chain: str = Body(..., embed=True)):
    """Check ETH balance of multiple stealth addresses via RPC."""
    rpc_map = {
        "base":        "https://rpc.ankr.com/base",
        "arbitrum":    "https://rpc.ankr.com/arbitrum",
        "polygon":     "https://rpc.ankr.com/polygon",
        "optimism":    "https://rpc.ankr.com/optimism",
        "bnb":         "https://rpc.ankr.com/bsc",
        "avalanche":   "https://rpc.ankr.com/avalanche",
        "hyperliquid": "https://rpc.hyperliquid.xyz/evm",
    }
    rpc = rpc_map.get(chain)
    if not rpc:
        raise HTTPException(status_code=400, detail="Unsupported chain")

    results = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for addr in addresses[:50]:  # max 50 at once
            try:
                r = await client.post(rpc, json={
                    "jsonrpc": "2.0", "method": "eth_getBalance",
                    "params": [addr, "latest"], "id": 1
                })
                bal_hex = r.json().get("result", "0x0")
                results[addr] = str(int(bal_hex, 16))
            except Exception:
                results[addr] = "0"
    return {"balances": results, "chain": chain}

# ═══════════════════════════════════════════════════════════════════════════════
# FOUNDER MODE — completely isolated router, separate token, zero overlap
# Route prefix: /api/founder  |  Auth: POST /api/founder/auth → founder session token
# Founder sessions are stored separately from user sessions (prefix "f:")
# ═══════════════════════════════════════════════════════════════════════════════

founder_router = APIRouter(prefix="/api/founder")

# Founder sessions: token -> expiry (separate dict from user _sessions)
_founder_sessions: dict = {}
FOUNDER_SESSION_TTL = 60 * 60 * 12  # 12 hours

def require_founder(request: StarletteRequest):
    """Validates founder session token from Authorization: Bearer header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Forbidden")
    token = auth.split(" ", 1)[1]
    exp = _founder_sessions.get(token)
    if not exp or _time.time() > exp:
        _founder_sessions.pop(token, None)
        raise HTTPException(status_code=403, detail="Forbidden")
    return token


@founder_router.post("/auth")
async def founder_auth(request: StarletteRequest, token: str = Body(..., embed=True)):
    """Exchange founder token for a session. Rate limited."""
    rate_limit(request, max_calls=5, window=60)
    expected = os.environ.get("ADMIN_TOKEN", "")
    if not expected or token != expected:
        raise HTTPException(status_code=403, detail="Forbidden")
    session = secrets.token_hex(32)
    _founder_sessions[session] = _time.time() + FOUNDER_SESSION_TTL
    return {"granted": True, "session": session, "expires_in": FOUNDER_SESSION_TTL}


@founder_router.get("/metrics", dependencies=[Depends(require_founder)])
async def founder_metrics():
    """Real-time platform metrics — all from live MongoDB collections."""
    try:
        # Transaction data
        total_txs = await db.transactions.count_documents({})
        pending_txs = await db.transactions.count_documents({"status": "pending"})
        completed_txs = await db.transactions.count_documents({"status": {"$in": ["completed", "confirmed"]}})

        # Volume — sum amount_wei from transactions
        pipeline_vol = [
            {"$match": {"status": {"$in": ["completed", "confirmed"]}}},
            {"$group": {"_id": None, "total_wei": {"$sum": "$amount_wei"}}}
        ]
        vol_result = await db.transactions.aggregate(pipeline_vol).to_list(1)
        total_volume_wei = vol_result[0]["total_wei"] if vol_result else 0

        # Per-chain tx counts
        chain_pipeline = [
            {"$group": {"_id": "$chain", "count": {"$sum": 1}, "volume_wei": {"$sum": "$amount_wei"}}}
        ]
        chain_data = await db.transactions.aggregate(chain_pipeline).to_list(20)
        chains_breakdown = {c["_id"]: {"txs": c["count"], "volume_wei": c.get("volume_wei", 0)} for c in chain_data if c["_id"]}

        # Stealth addresses
        total_stealth = await db.stealth_addresses.count_documents({})
        used_stealth = await db.stealth_addresses.count_documents({"used": True})
        stealth_by_chain = await db.stealth_addresses.aggregate([
            {"$group": {"_id": "$chain", "count": {"$sum": 1}}}
        ]).to_list(20)

        # Wallets
        total_wallets = await db.wallets.count_documents({})
        privacy_wallets = await db.privacy_wallets.count_documents({})

        # DeFi trades
        total_trades = await db.defi_trades.count_documents({})
        platform_breakdown = await db.defi_trades.aggregate([
            {"$group": {"_id": "$platform", "count": {"$sum": 1}, "volume_usd": {"$sum": "$size_usd"}}}
        ]).to_list(10)

        # Encrypted messages
        total_messages = await db.encrypted_messages.count_documents({})
        unread_messages = await db.encrypted_messages.count_documents({"read": False})

        # ZKP proofs
        total_proofs = await db.zkp_proofs.count_documents({})
        verified_proofs = await db.zkp_proofs.count_documents({"status": "verified"})

        # Cross-chain splits
        total_splits = await db.cross_chain_splits.count_documents({})

        # Errors in last 24h
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        recent_errors = await db.error_logs.count_documents({"logged_at": {"$gte": since}}) if "error_logs" in await db.list_collection_names() else 0

        # Multisig wallets
        total_multisig = await db.multisig_wallets.count_documents({})

        # Recent activity (last 10 transactions, sanitized)
        recent_txs_raw = await db.transactions.find(
            {}, {"_id": 0, "from_address": 1, "to_address": 1, "amount_wei": 1, "chain": 1, "tx_type": 1, "status": 1, "created_at": 1}
        ).sort("created_at", -1).limit(10).to_list(10)

        return {
            "transactions": {
                "total": total_txs,
                "pending": pending_txs,
                "completed": completed_txs,
                "total_volume_wei": str(total_volume_wei),
                "by_chain": chains_breakdown,
            },
            "stealth": {
                "total_generated": total_stealth,
                "used": used_stealth,
                "unused": total_stealth - used_stealth,
                "by_chain": {c["_id"]: c["count"] for c in stealth_by_chain if c["_id"]},
            },
            "wallets": {
                "standard": total_wallets,
                "privacy": privacy_wallets,
                "multisig": total_multisig,
            },
            "defi": {
                "total_trades": total_trades,
                "by_platform": {p["_id"]: {"count": p["count"], "volume_usd": p.get("volume_usd", 0)} for p in platform_breakdown if p["_id"]},
            },
            "messaging": {
                "total": total_messages,
                "unread": unread_messages,
            },
            "zkp": {
                "total_proofs": total_proofs,
                "verified": verified_proofs,
            },
            "splits": total_splits,
            "errors_24h": recent_errors,
            "recent_activity": recent_txs_raw,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error(f"Founder metrics error: {e}")
        raise HTTPException(status_code=500, detail="Metrics unavailable")


@founder_router.get("/chains/health", dependencies=[Depends(require_founder)])
async def founder_chain_health():
    """Ping all 7 chain RPCs and return live status."""
    import asyncio

    rpc_map = {
        "base":        "https://rpc.ankr.com/base",
        "arbitrum":    "https://rpc.ankr.com/arbitrum",
        "polygon":     "https://rpc.ankr.com/polygon",
        "optimism":    "https://rpc.ankr.com/optimism",
        "bnb":         "https://rpc.ankr.com/bsc",
        "avalanche":   "https://rpc.ankr.com/avalanche",
        "hyperliquid": "https://rpc.hyperliquid.xyz/evm",
    }

    async def ping_chain(name: str, url: str):
        payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.post(url, json=payload)
                data = r.json()
                block_hex = data.get("result", "0x0")
                block_num = int(block_hex, 16)
                return {"chain": name, "status": "online", "block": block_num, "latency_ms": round(r.elapsed.total_seconds() * 1000)}
        except Exception as e:
            return {"chain": name, "status": "offline", "error": str(e)[:80]}

    tasks = [ping_chain(n, u) for n, u in rpc_map.items()]
    results = await asyncio.gather(*tasks)
    online = sum(1 for r in results if r["status"] == "online")
    return {"chains": results, "online": online, "total": len(results), "timestamp": datetime.now(timezone.utc).isoformat()}


@founder_router.get("/activity", dependencies=[Depends(require_founder)])
async def founder_activity(limit: int = 50):
    """Recent activity across all collections — real data only."""
    txs = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    stealth = await db.stealth_addresses.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    trades = await db.defi_trades.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    messages = await db.encrypted_messages.find({}, {"_id": 0, "encrypted_content": 0}).sort("created_at", -1).limit(10).to_list(10)
    splits = await db.cross_chain_splits.find({}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    return {
        "transactions": txs,
        "stealth_addresses": stealth,
        "defi_trades": trades,
        "messages": messages,
        "splits": splits,
    }


@founder_router.get("/system", dependencies=[Depends(require_founder)])
async def founder_system():
    """System info — backend health, DB status, session count."""
    import sys
    col_names = await db.list_collection_names()
    col_counts = {}
    for col in col_names:
        col_counts[col] = await db[col].count_documents({})

    return {
        "backend": "online",
        "python_version": sys.version,
        "active_sessions": len(_sessions),
        "database": {
            "status": "connected",
            "name": os.environ.get("DB_NAME"),
            "collections": col_counts,
        },
        "deployer_wallet": "0x88993B262B8a89fe9888AD3bc0aF04b89932a9d4",
        "contracts_deployed": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', 'https://privacycloak.in').split(','),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# ── Serve React Frontend (production only — when build/ exists) ────────────
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.is_dir():
    # Serve static assets (JS, CSS, images)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR / "static")), name="react-static")

    # SPA fallback — serve index.html for all non-API routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If the file exists in build dir, serve it (favicon, manifest, etc.)
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        # Otherwise serve index.html for client-side routing
        return FileResponse(str(STATIC_DIR / "index.html"))
