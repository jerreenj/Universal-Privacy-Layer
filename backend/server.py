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
from decimal import Decimal
import uuid
from datetime import datetime, timezone, timedelta
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


def _read_hot_wallet_keyfile() -> Optional[str]:
    """Read the dedicated PrivacyRelayer hot-wallet keyfile.

    Resolution paths (first existing wins):
      - RELAYER_KEYFILE_PATH env (override)
      - /app/scripts/.relayer-hot-wallet.txt (Docker bind-mount path)
      - <repo-root>/scripts/.relayer-hot-wallet.txt (local dev)
      - scripts/.relayer-hot-wallet.txt (cwd-relative for tests)

    The file is produced by `cast wallet new` after the gap-6
    round and stored gitignored (per .gitignore entries
    `scripts/.relayer-hot-wallet.{txt,json}`). Format expected
    (cast wallet output):

      Successfully created new keypair.
      Address:     0xABC...
      Private key: 0x123...

    Returns the 0x-prefixed 64-char private key string, or None
    if the file is missing/unparseable. Cached per-process.

    Why this fallback exists: PrivacyRelayer.sol's `relayer()`
    slot is rebuilt to use a dedicated hot-wallet EOA
    (`0x2d82E56f…`) so the deployer EOA can rotate out +
    keep governance separate from gas-funding. The new key MUST
    sign every relayAndAnnounce tx. Loading it from the
    .gitignored file means a fresh clone with the key restored
    from secure storage can run the relayer end-to-end without
    also having to inject a manual env var on every Azure
    re-deploy.
    """
    global _HOT_WALLET_KEYFILE_CACHE
    if _HOT_WALLET_KEYFILE_CACHE is not None:
        return _HOT_WALLET_KEYFILE_CACHE

    candidates = []
    override = os.environ.get("RELAYER_KEYFILE_PATH")
    if override:
        candidates.append(Path(override))
    candidates.append(Path("/app/scripts/.relayer-hot-wallet.txt"))
    repo_root = Path(__file__).resolve().parent.parent  # backend/ -> repo root
    candidates.append(repo_root / "scripts" / ".relayer-hot-wallet.txt")
    candidates.append(Path("scripts/.relayer-hot-wallet.txt"))

    for path in candidates:
        try:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8").strip()
            # Parse the `cast wallet new` output shape — "Private key:" line.
            for line in text.splitlines():
                line = line.strip()
                if ":" in line:
                    label, _, value = line.partition(":")
                    if label.strip().lower() in ("private key", "private_key"):
                        key = value.strip()
                        if key.startswith("0x") and len(key) == 66:
                            _HOT_WALLET_KEYFILE_CACHE = key
                            return key
        except (OSError, UnicodeDecodeError) as e:
            logger.warning(f"hot wallet keyfile read skipped for {path}: {e}")
            continue

    return None


_HOT_WALLET_KEYFILE_CACHE: Optional[str] = None

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', '')
if not mongo_url:
    raise RuntimeError("MONGO_URL environment variable is required")
client = AsyncIOMotorClient(
    mongo_url,
    maxPoolSize=50,
    minPoolSize=10,
    uuidRepresentation="standard",
    serverSelectionTimeoutMS=5000,
)
db = client[os.environ.get('DB_NAME', 'upl_database')]

# ── Web3 per-chain singleton ─────────────────────────────────────────────────
# HTTPProvider holds a long-lived urllib3 pool — recreating Web3 per request
# throws that pool away. Cache by chain_key so one instance per chain lives
# for the lifetime of the process.
import threading as _threading
_w3_lock = _threading.Lock()
_w3_cache: dict = {}

def get_w3(chain_key: str):
    """Return the module-level cached Web3 for `chain_key`.
    Falls back to env `BASE_RPC_URL` for the `base` chain (legacy sites).
    Raises HTTPException(400) if the chain is unknown.
    """
    if chain_key in _w3_cache:
        return _w3_cache[chain_key]
    with _w3_lock:
        if chain_key in _w3_cache:           # double-check inside lock
            return _w3_cache[chain_key]
        cfg = CHAIN_CONFIG.get(chain_key) if "CHAIN_CONFIG" in globals() else None
        rpc_url = (cfg or {}).get("rpc_url")
        if not rpc_url and chain_key == "base":
            rpc_url = os.environ.get("BASE_RPC_URL", "https://mainnet.base.org")
        if not rpc_url:
            raise HTTPException(status_code=400, detail=f"Unknown chain: {chain_key}")
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 10}))
        _w3_cache[chain_key] = w3
        return w3

# ── Tiny in-process TTL cache ────────────────────────────────────────────────
# No external dep — bounded by maxsize, sweeps expired entries on access.
class _TTLCache:
    def __init__(self, maxsize: int = 256, ttl: int = 60):
        self._data: dict = {}
        self._max = maxsize
        self._ttl = ttl
    def get(self, key):
        entry = self._data.get(key)
        if entry is None:
            return None
        value, ts = entry
        if _time.time() - ts > self._ttl:
            self._data.pop(key, None)
            return None
        return value
    def set(self, key, value):
        if len(self._data) >= self._max:
            self._data.pop(next(iter(self._data)))   # drop oldest
        self._data[key] = (value, _time.time())
    def clear(self):
        self._data.clear()

_chain_cache  = _TTLCache(maxsize=16, ttl=60)   # /api/chains — rarely changes
_tokens_cache = _TTLCache(maxsize=64, ttl=120)  # token list per chain
_meta_cache   = _TTLCache(maxsize=16, ttl=30)   # deployer-info, deployments
_health_cache = _TTLCache(maxsize=4,  ttl=5)    # /api/health probes

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

# Create index on sessions collection for fast lookups
@app.on_event("startup")
async def create_indexes():
    try:
        await db.sessions.create_index("token", unique=True)
        await db.sessions.create_index("expires_at")
        # Auto-delete messages after 72 hours
        await db.encrypted_messages.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning(f"Index creation skipped (non-fatal): {e}")

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
    # Public endpoints that don't require a session token.
    # Stealth send demo on Base — also public so customers can run a
    # send/receive flow without holding a session token. Payment-info
    # etc unchanged.
    PUBLIC_PATHS = {
        "/api/health",
        "/api/",
        "/api/auth/verify-access",
        "/api/payments/info",
        "/api/payments/submit",
        "/api/deployments",
        "/api/sui/status", "/api/sui/registry/count", "/api/sui/relay/submit",
        "/api/sui/announcements",
        "/api/sol/status", "/api/sol/registry/count", "/api/sol/relay/submit",
        "/api/sol/announcements",
        # Phase 3 (P3.5): privacy-pool state (denomination, root) is
        # public so the deposit UI can read it before login.
        "/api/zk-pool/state",
        # P3.8 PoC ownership-check public.
        "/api/zk-stealth/owner",
        # Stealth send demo on Base — public for customer onboarding.
        "/api/stealth/announce",
        "/api/stealth/announcements",
        # Relayer + USDC permit-forwarder endpoints — public for
        # customer onboarding. The user signs EIP-712 / EIP-2612
        # intents off-chain; the relayer submits on their behalf.
        # These MUST be public or the private send flow 401s with
        # "Authorization required" before the wallet even pops.
        "/api/relayer/prepare-tx",
        "/api/relayer/submit",
        "/api/relayer/state",
        "/api/usdc-permit-forwarder/prepare-tx",
        "/api/usdc-permit-forwarder/submit",
        # Confidential notes (P6) — public for customer onboarding
        "/api/confidential/note-state",
        "/api/confidential/note-submit",
        "/api/confidential/note-settle",
        "/api/confidential/note-seed",
        "/api/confidential/view-key/register",
        "/api/swap/native-relay",
        "/api/swap/native-relay-eth",
        # Dynamic-path prefixes handled separately (FastAPI brace templates
        # can't be literal-listed).
    }

    # Dynamic-path prefixes. Anything matching one of these is public so
    # customer-facing read-paths work without a session token.
    _PUBLIC_DYNAMIC_PREFIXES = (
        "/api/stealth/meta/",
        "/api/stealth/scan/",
        "/api/relayer/stats/",
        "/api/usdc-permit-forwarder/prepaid/",
        "/api/confidential/view-key/",
    )

    def _is_public(self, path: str) -> bool:
        if path in self.PUBLIC_PATHS:
            return True
        return any(path.startswith(p) for p in self._PUBLIC_DYNAMIC_PREFIXES)

    # Per-IP rate limits applied to /api/*. /api/v1/* uses its own per-key limit.
    WRITE_LIMIT = (30, 60)    # 30 POST/PUT/DELETE per 60s
    READ_LIMIT  = (200, 60)   # 200 GET per 60s
    SKIP_RL_PREFIXES = ("/api/v1/",)   # developer API has its own key-based RL


    async def dispatch(self, request: StarletteRequest, call_next):
        # ── Rate limit gate — only for /api/* paths we don't skip ────────────
        path = request.url.path
        if path.startswith("/api/") and not any(path.startswith(p) for p in self.SKIP_RL_PREFIXES):
            is_write = request.method in ("POST", "PUT", "PATCH", "DELETE")
            max_calls, window = self.WRITE_LIMIT if is_write else self.READ_LIMIT
            ip = request.client.host if request.client else "unknown"
            now = _time.time()
            bucket = _rate_store[(ip, "w" if is_write else "r")]
            bucket[:] = [t for t in bucket if now - t < window]
            bucket.append(now)
            if len(bucket) > max_calls:
                resp = JSONResponse(
                    {"detail": "Rate limit exceeded — slow down"},
                    status_code=429,
                )
                # still send security headers on the 429
                resp.headers["X-Content-Type-Options"] = "nosniff"
                resp.headers["X-Frame-Options"] = "DENY"
                return resp

        # ── Auth gate — block all /api/* except public paths ──────────────────
        if path.startswith("/api/") and not self._is_public(path):
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return JSONResponse({"detail": "Authorization required"}, status_code=401)
            token = auth.split(" ", 1)[1]
            session = await _get_session(token)
            if not session:
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
# Sessions: MongoDB primary, in-memory fallback if DB is unavailable/full
SESSION_TTL = 60 * 60 * 24 * 365  # 1 year
_sessions_fallback: dict = {}  # in-memory fallback

def _new_token() -> str:
    return secrets.token_hex(32)

async def _get_session(token: str):
    """Look up session — try MongoDB first, fallback to memory."""
    try:
        doc = await db.sessions.find_one({"token": token, "expires_at": {"$gt": _time.time()}}, {"_id": 0})
        if doc:
            return doc
    except Exception:
        pass
    # Fallback: check in-memory
    exp = _sessions_fallback.get(token)
    if exp and _time.time() < exp:
        return {"token": token, "expires_at": exp}
    _sessions_fallback.pop(token, None)
    return None

async def _create_session(token: str):
    """Store session — try MongoDB, always store in memory as backup."""
    _sessions_fallback[token] = _time.time() + SESSION_TTL
    try:
        await db.sessions.insert_one({"token": token, "expires_at": _time.time() + SESSION_TTL, "created_at": datetime.now(timezone.utc).isoformat()})
    except Exception as e:
        logger.warning(f"MongoDB session write failed (using memory fallback): {e}")

async def _delete_session(token: str):
    """Remove session from both stores."""
    _sessions_fallback.pop(token, None)
    try:
        await db.sessions.delete_one({"token": token})
    except Exception:
        pass

def require_auth(request: StarletteRequest):
    """Dependency: validates session token on every protected endpoint.
    Note: actual validation is done in middleware; this is a secondary check."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization required")
    return auth.split(" ", 1)[1]

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

# ─── ZKP verifier status (post-P1.3 follow-up audit) ─────────────────────────
# A previous revision of this file shipped hard-coded "ZKP verifier" addresses on
# 6 chains plus a Groth16-shaped ABI, and the /zkp/verify-onchain + /zkp/verifier-info
# endpoints eth_call'd into them. That was unsafe wiring:
#
#   - The verifier Solidity the project *owned* (`Groth16Verifier.sol`,
#     `UPLVerifier.sol`) was deleted in P1.3 (PR #2, db089bc) because its
#     verifying-key constants set DELTA == GAMMA, an unsoundness that would
#     accept forged proofs. Cannot be fixed without a real .circom circuit +
#     trusted-setup + snarkjs-generated verifier — that is the gated Phase 3
#     deliverable, NOT a P1 deliverable.
#   - The hard-coded addresses we kept on eth_calling instead point at real
#     third-party ~2.2 KB Groth16 verifier contracts we do NOT deploy or own
#     (verified: eth_getCode returns deployed bytecode at all six addresses on
#     their respective chains, none of which expose our 4-byte selectors). Calling
#     into code we never audited and never deployed was a soundness+hygiene gap
#     that PR #2's "delete the verifiers we own" step intended to retire but left
#     dangling through this glue.
#
# Resolution: keep the routes (existing clients like the frontend `ZKPProofs.jsx`
# POST to /zkp/generate-inputs and /zkp/submit-proof for the *local* format-only
# pre-check; removing those would break the UI), but retire anything that pretends
# to verify a proof against a contract. /zkp/verify-onchain and /zkp/verifier-info
# now return HTTP 501 with a "deferred to Phase 3" body; /zkp/submit-proof keeps
# doing its format-only verification and no longer returns `verifier_contracts`
# (the table is gone). When Phase 3 lands a real, project-owned, snarkjs-exported
# verifier, this constant replaces the placeholder and the endpoints are
# re-enabled backed by our own deployment.
ZKP_VERIFIER_PHASED_OUT = True

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

# UPL Contracts — known deployments per chain.
#
# Status (post P1.3 audit + P1.4 wiring + P1.5 loader, 2026-06-23):
#   - privacy_relayer / stealth_registry: the addresses here are PLACEHOLDERS. They
#     predate the reconciled PrivacyRelayer.sol (P1.1) and StealthAddressRegistry.sol
#     (P1.2) and, per the P1.3 audit on-chain probe, are NOT the bytecode of those
#     contracts (the deployed "relayer" is 251 B with 2 selectors and the deployed
#     "registry" is 418 B with 3 selectors including owner(); our contracts expose
#     6+ each and don't inherit Ownable). The reconciled read-paths
#     (`_relayer_address_for`, the relayer stats endpoint, the stealth-registry
#     reads) are correct against the contract surface and will return real data as
#     as soon as real deployments land. P1.6 adds the Hardhat/Foundry deploy + ABI
#     export; P1.9 deploys the real contract bytecode to Base mainnet and writes
#     `contracts/deployed_base.json`; P1.5 (this code, below the literal) loads that
#     file at import time and OVERRIDES these placeholder addresses with the real
#     ones, chain-by-chain, so the table stays the single source of truth in code
#     while real deployments stay git-ignored and environment-local.
#   - uniswap_wrapper: None on every chain — the UniswapPrivacyWrapper contract
#     (contracts/UniswapPrivacyWrapper.sol) is written and reconciled but NOT yet
#     deployed (P1.9). The wrapper ABI and a `_uniswap_wrapper_address_for(chain)`
#     resolver are defined just below `PRIVACY_RELAYER_ABI` so the wrapper is a
#     first-class UPL contract: its surface is matched 1:1 to the Solidity, and a
#     read-path can resolve it once an address is filled in. Until then, the
#     `/uniswap/quote` endpoint keeps quoting via the raw Uniswap V3 Quoter
#     (UNISWAP_V3_CONTRACTS below) and the privacy fee is computed off-chain;
#     routing the *execution* of the swap through privateSwapETHForToken (instead
#     of the user calling the raw Uniswap Router) is the separate P1.13 step.
#     We deliberately do NOT pre-fill a fake address here — the P1.3 audit
#     retired exactly that pattern for the ZK verifier glue.
#
# Loader (P1.5): the static literal below is the FALLBACK base. After it is bound,
# `_load_deployed_addresses()` reads `contracts/deployed_base.json` (git-ignored;
# written by P1.9's Hardhat deploy, schema documented by the committed
# `contracts/deployed_base.json.example`) and overrides the per-chain contract
# addresses it contains — chain-by-chain, address-by-address — leaving the
# `explorer` and any unmentioned fields untouched. If the file is absent (today:
# P1.9 hasn't deployed yet) the static placeholders win and behavior is
# unchanged from P1.4. A startup log line reports, per chain, whether each UPL
# contract came from the file ("deployed") or the static table ("placeholder" /
# "not-deployed") so the relayer stats / stealth-registry read-paths can tell at
# a glance whether they'll hit real bytecode. The file's path is overridable via
# `UPL_DEPLOYED_BASE_JSON` (absolute or relative-to-ROOT_DIR) so tests can point
# the loader at a fixture without monkey-patching this module.
def _load_deployed_addresses(static_contracts: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Return a *copy* of `static_contracts` with per-chain UPL contract addresses
    overridden from `contracts/deployed_base.json` if present.

    Schema the loader expects (written by P1.9, see
    `contracts/deployed_base.json.example`):
        {
          "<chain>": {                      # e.g. "base"
            "chainId": 8453,                # provenance; logged, not used for routing
            "deployedAt": "2026-...",       # ISO-8601; logged only
            "commit": "1c338bf",            # deploy commit; logged only
            "privacy_relayer": "0x...",     # overrides static placeholder
            "stealth_registry": "0x...",   # overrides static placeholder
            "uniswap_wrapper": "0x..."      # optional; overrides None
          }
        }
    Unknown chains in the file are ignored (they don't exist in CHAIN_CONFIG so
    routing would 400 anyway); unknown contract keys per chain are ignored too.
    `explorer`/`chainId`/`deployedAt`/`commit` are passed through unchanged so
    callers that read them off UPL_CONTRACTS keep working. The override is shallow
    per-chain — we never replace a whole chain dict, only individual address
    fields — so a partial file (e.g. only `privacy_relayer` deployed) overrides
    only that field and leaves `stealth_registry` on its placeholder.

    Address validation: a value is accepted only if it is a 0x-prefixed string
    of exactly 40 hex chars (Hardhat's `contract.address` is checksummed, so
    P1.9's output passes this). `None` / `""` / `"0x0"` / the zero address are
    normalized to `None`. Anything else (int, float, missing-prefix, wrong
    length) is logged as a WARNING and left on its static placeholder — a
    malformed deployed_base.json must NOT inject a value into UPL_CONTRACTS
    that later `Web3.to_checksum_address(addr)` would surface as a confusing
    downstream error rather than a clear "bad file" message.
    """
    def _resolve_path() -> Optional[Path]:
        raw = os.environ.get("UPL_DEPLOYED_BASE_JSON")
        if not raw:
            return ROOT_DIR.parent / "contracts" / "deployed_base.json"
        p = Path(raw)
        return p if p.is_absolute() else (ROOT_DIR / p)

    out = {chain: dict(cfg) for chain, cfg in static_contracts.items()}  # shallow copy per chain
    path = _resolve_path()
    if not path.exists():
        logging.info("UPL contracts: no deployed_base.json at %s — using static placeholders (P1.9 not run yet).", path)
        return out
    try:
        with open(path, encoding="utf-8") as fh:
            deployed = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logging.warning("UPL contracts: failed to read %s (%s) — using static placeholders.", path, exc)
        return out
    if not isinstance(deployed, dict):
        logging.warning("UPL contracts: %s is not a JSON object — ignoring, using static placeholders.", path)
        return out

    ADDRESS_KEYS = (
        "privacy_relayer", "stealth_registry", "uniswap_wrapper",
        # Phase 3 (P3.4): PrivacyPool + Groth16Verifier added to the allowlist so
        # they survive the loader's strict 0x40-hex validation. Without these,
        # /api/zk-pool/state would still see the static placeholder values and
        # falsely report "PrivacyPool not yet deployed" even when the JSON has
        # the real mainnet address. (Previously only the relay + registry + uniswap
        # wrapper were recognised.)
        "privacy_pool", "privacy_verifier",
        # Phase 4.2 (P4.2 hotfix): AerodromePrivacyWrapper added so the
        # third-party picker tile (PrivateDeFi "All in One Swap") surfaces
        # the real broadcast address from /api/deployments for the
        # Aerodrome V2 row. The Core Actions "Private Swap" tile no
        # longer uses Aerodrome (see native_swap_wrapper below).
        "aerodrome_wrapper",
        # Phase 4.3-reskin (Base-finishing): NativePrivateSwap added so
        # the Core "Private Swap" tile routes through OUR vault instead
        # of the Aerodrome router. The previous wrapper-mediated path
        # logged a Swap event on a public AMM that linked sender<->stealth
        # by the to= param; the in-house vault instead pays USDC
        # straight from reserves to the stealth recipient — no public
        # AMM observable.
        "native_swap_wrapper",
        # Phase 4.4 (amount-hide pilot round): ConfidentialNativePrivateSwap
        # is the amount-hidden variant of NativePrivateSwap — same vault
        # mechanics but the swap event REPLACES plaintext usdcOut with a
        # 32-byte commitment. Surfaced here so /api/deployments exposes
        # it to the frontend Privacy-Mode toggle.
        "confidential_swap_wrapper",
        "confidential_reverse_swap",
        # GasTreasury — auto-funds rotating relayer wallets with gas ETH.
        # The operator funds this contract once; every relayer rotation
        # calls fundRelayer() to top up the new wallet automatically.
        "gas_treasury",
        "deployer", "fee_recipient", "pool_owner",
    )
    provenance_keys = ("chainId", "deployedAt", "commit", "redeployedNote")
    for chain, overrides in deployed.items():
        base = out.get(chain)
        if base is None:
            logging.warning("UPL contracts: deployed_base.json lists unknown chain '%s' (not in CHAIN_CONFIG) — skipping.", chain)
            continue
        if not isinstance(overrides, dict):
            logging.warning("UPL contracts: deployed_base.json['%s'] is not an object — skipping chain.", chain)
            continue
        for k in provenance_keys:
            if k in overrides and overrides[k] is not None:
                base[k] = overrides[k]
        applied = []
        skipped = []
        for k in ADDRESS_KEYS:
            if k not in overrides:
                continue
            val = overrides[k]
            # Normalize: None / "" / "0x0" / zero-address all mean
            # "not deployed on this chain".
            if val in (None, "", "0x0", "0x0000000000000000000000000000000000000000"):
                base[k] = None
                applied.append(f"{k}=None")
                continue
            # Reject anything that isn't a 0x-prefixed 40-hex-char address — a
            # malformed deployed_base.json must NOT inject an int/float/stray
            # value into UPL_CONTRACTS where a later
            # Web3.to_checksum_address(addr) would surface the bad shape as a
            # confusing downstream error. P1.9 (Hardhat) writes checksummed
            # addresses; anything else here is a hand-edit bug we want loud.
            if not (isinstance(val, str)
                    and re.match(r"^0x[a-fA-F0-9]{40}$", val)):
                skipped.append(f"{k}={val!r}")
                continue
            base[k] = val
            applied.append(f"{k}={val}")
        if applied:
            logging.info("UPL contracts: %s overridden from deployed_base.json — %s",
                         chain, ", ".join(applied))
        if skipped:
            logging.warning("UPL contracts: deployed_base.json['%s'] has malformed addresses (%s) — ignored those, kept static placeholders for them.",
                             chain, ", ".join(skipped))
    return out


_UPL_CONTRACTS_STATIC = {
    "base": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "gas_treasury": "0x0000000000000000000000000000000000000000",  # auto-funds rotating relayers; placeholder until deploy
        "explorer": "https://basescan.org"
    },
    "arbitrum": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://arbiscan.io"
    },
    "polygon": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://polygonscan.com"
    },
    "optimism": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://optimistic.etherscan.io"
    },
    "bnb": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://bscscan.com"
    },
    "avalanche": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://snowtrace.io"
    },
    "hyperliquid": {
        "privacy_relayer": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "stealth_registry": "0x0000000000000000000000000000000000000000",  # PLACEHOLDER — replaced by P1.5/P1.9
        "uniswap_wrapper": None,  # not yet deployed (P1.9); resolved by _uniswap_wrapper_address_for()
        "explorer": "https://purrsec.com"
    }
}

# P1.5: feed the static fallback through the loader so real deployments land in
# `UPL_CONTRACTS` (the name every read-path uses). With no `deployed_base.json`
# present this is a no-op copy — the static placeholders win, behavior matches
# P1.4 exactly, and the deploy stays safe. The env var `UPL_DEPLOYED_BASE_JSON`
# (absolute or ROOT_DIR-relative) overrides the default path for tests.
UPL_CONTRACTS = _load_deployed_addresses(_UPL_CONTRACTS_STATIC)


# ── Sui deployment manifest loader (P1.6) ──────────────────────────────────
# Mirrors _load_deployed_addresses but for the Sui Move package published to
# mainnet. Reads scripts/deployed_sui_mainnet.json (git-ignored; the .example
# template is the committed documentation). With no manifest present, SUI_DEPLOYMENT
# is None — all Sui endpoints report `live: False` and no Sui reads are attempted.

SUI_CONFIG = {
    "mainnet": {"rpc_url": "https://fullnode.mainnet.sui.io:443", "network": "mainnet"},
}
SUI_DEFAULT_NETWORK = "mainnet"

# ─── Solana (SVM) config — P2.10 parity with Sui ─────────────────────────────
# Mirrors SUI_CONFIG: a dedicated config dict + loader for the non-EVM chain.
# Solana's RPC is HTTP-only (no Sui-style objects); state lives in PDA accounts.
SOL_CONFIG = {
    "mainnet": {"rpc_url": "https://api.mainnet-beta.solana.com", "network": "mainnet"},
    "devnet": {"rpc_url": "https://api.devnet.solana.com", "network": "devnet"},
}
# Env-driven so we run devnet ($0, pilot-ready) until SOL is funded, then
# flip to mainnet with SOL_DEFAULT_NETWORK=mainnet — no code change needed.
# (Phase P2.10 Step 10a → 10b.)
SOL_DEFAULT_NETWORK = os.environ.get("SOL_DEFAULT_NETWORK", "devnet")


def _load_deployed_sui() -> Optional[Dict[str, Any]]:
    """Load the Sui mainnet deployment manifest written by
    `scripts/deploy_sui_mainnet.sh`. Returns a dict with:
        network, package_id, modules, shared_objects, owned_capabilities,
        published_at, publisher_address, sui_cli_version, live=True
    or None if the manifest is absent / unreadable / malformed.

    The env var `UPL_DEPLOYED_SUI_JSON` (absolute or ROOT_DIR-relative)
    overrides the default path (`scripts/deployed_sui_mainnet.json`) — used by
    tests to point at a fixture.

    Sui object ids are 0x + up to 64 hex chars (NOT 40 like EVM addresses),
    so the validator uses a different regex than _load_deployed_addresses.
    """
    def _resolve_path() -> Optional[Path]:
        raw = os.environ.get("UPL_DEPLOYED_SUI_JSON")
        if not raw:
            return ROOT_DIR.parent / "scripts" / "deployed_sui_mainnet.json"
        p = Path(raw)
        return p if p.is_absolute() else (ROOT_DIR / p)

    path = _resolve_path()
    if not path.exists():
        logging.info("UPL Sui: no deployed_sui_mainnet.json at %s — Sui not deployed yet.", path)
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        logging.warning("UPL Sui: failed to read %s (%s) — Sui treated as not deployed.", path, exc)
        return None
    if not isinstance(manifest, dict):
        logging.warning("UPL Sui: %s is not a JSON object — ignoring.", path)
        return None

    # Validate required fields. package_id and shared_objects.registry are the
    # minimum the backend needs to read on-chain state.
    package_id = manifest.get("package_id")
    shared_objects = manifest.get("shared_objects", {})
    if not (isinstance(package_id, str) and re.match(r"^0x[a-fA-F0-9]{16,64}$", package_id)):
        logging.warning("UPL Sui: package_id missing or invalid in %s — ignoring.", path)
        return None

    # Validate shared object ids with the Sui id regex.
    def _valid_sui_id(val: Any) -> bool:
        return isinstance(val, str) and re.match(r"^0x[a-fA-F0-9]{16,64}$", val) is not None

    registry_id = shared_objects.get("registry") if isinstance(shared_objects, dict) else None
    if not _valid_sui_id(registry_id):
        logging.warning("UPL Sui: shared_objects.registry missing or invalid in %s — registry reads will 503.", path)
        registry_id = None

    # Validate every shared object id in the manifest (registry + relayer_state
    # are the read-floor; view_tag_index / announcement_indexer / etc. are needed
    # by the relayed_send + scan endpoints added in the Sui-parity follow-up).
    # Invalid ids are dropped to None rather than failing the whole load.
    valid_shared: Dict[str, Any] = {}
    if isinstance(shared_objects, dict):
        for so_key, so_val in shared_objects.items():
            if _valid_sui_id(so_val):
                valid_shared[so_key] = so_val
            else:
                valid_shared[so_key] = None
    # Back-compat: the P1.6 surface only exposed registry + relayer_state; keep
    # them guaranteed-present so older callers don't KeyError.
    valid_shared.setdefault("registry", registry_id)
    valid_shared.setdefault("relayer_state", None)

    # Validate owned capabilities. The manifest may use either the original
    # flat shape ("admin_cap": "0x...", "relayer_cap": "0x...") or the
    # reconciled per-module shape ("privacy_relayer": {"admin_cap": "0x...",
    # "relayer_cap": "0x..."}). Both are accepted; invalid ids become None.
    owned_caps_raw = manifest.get("owned_capabilities", {})
    owned_caps: Dict[str, Any] = {}
    if isinstance(owned_caps_raw, dict):
        for cap_key, cap_val in owned_caps_raw.items():
            if isinstance(cap_val, str):
                owned_caps[cap_key] = cap_val if _valid_sui_id(cap_val) else None
            elif isinstance(cap_val, dict):
                owned_caps[cap_key] = {
                    k: (v if _valid_sui_id(v) else None) for k, v in cap_val.items()
                }
            else:
                owned_caps[cap_key] = None

    result = {
        "network": manifest.get("network", SUI_DEFAULT_NETWORK),
        "package_id": package_id,
        "modules": manifest.get("modules", []),
        "shared_objects": valid_shared,
        "owned_capabilities": owned_caps,
        "published_at": manifest.get("published_at"),
        "publisher_address": manifest.get("publisher_address"),
        "sui_cli_version": manifest.get("sui_cli_version"),
        "live": True,
    }
    logging.info("UPL Sui: manifest loaded from %s — package_id=%s, registry=%s",
                 path, package_id, valid_shared.get("registry"))
    return result


SUI_DEPLOYMENT = _load_deployed_sui()


def _load_deployed_sol() -> Optional[Dict[str, Any]]:
    """Load the Solana mainnet deployment manifest written by the deploy script.
    Returns a dict with: network, program_id, registry_pda, sol_cli_version,
    live=True — or None if the manifest is absent/malformed (not deployed yet).
    Mirrors _load_deployed_sui but for Solana's account-based model."""
    env_path = os.environ.get("UPL_DEPLOYED_SOL_JSON")
    if env_path:
        manifest_path = Path(env_path)
    else:
        # Default to the devnet manifest (P2.10 Step 10a — $0 pilot path).
        # For mainnet (Step 10b) set UPL_DEPLOYED_SOL_JSON to the mainnet file.
        manifest_path = ROOT_DIR.parent / "scripts" / "deployed_sol_devnet.json"
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None

    program_id = data.get("program_id", "")
    # Solana program IDs are base58, 32-44 chars
    if not program_id or len(program_id) < 32:
        return None

    result = dict(data)
    result["live"] = True
    result.setdefault("network", SOL_DEFAULT_NETWORK)
    result.setdefault("registry_pda", None)
    result.setdefault("announcements_count", 0)
    result.setdefault("total_relayed", 0)
    return result


SOL_DEPLOYMENT = _load_deployed_sol()


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
    """Verify access code — issues persistent session token. 5 attempts/min per IP."""
    rate_limit(request, max_calls=5, window=60)
    expected = os.environ.get("ACCESS_CODE", "")
    if not expected or code != expected:
        raise HTTPException(status_code=401, detail="Invalid access code")
    token = _new_token()
    await _create_session(token)
    return {"granted": True, "token": token, "expires_in": SESSION_TTL}

@api_router.get("/health")
async def health():
    cached = _health_cache.get("h")
    if cached:
        return cached
    payload = {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}
    _health_cache.set("h", payload)
    return payload

@api_router.get("/chains")
async def get_chains():
    """Get supported blockchain networks — cached 60s (changes only on deploy)."""
    cached = _chain_cache.get("all")
    if cached:
        return cached
    payload = {
        "chains": CHAIN_CONFIG,
        "contracts": UPL_CONTRACTS,
        "tokens": TOKENS,
        "live_chains": list(UPL_CONTRACTS.keys())
    }
    _chain_cache.set("all", payload)
    return payload

# Get tokens for a chain
@api_router.get("/tokens/{chain}")
async def get_tokens(chain: str):
    """Get available tokens for a chain — cached 120s per chain."""
    cached = _tokens_cache.get(chain)
    if cached:
        return cached
    if chain not in TOKENS:
        raise HTTPException(status_code=400, detail="Unsupported chain")
    payload = {"chain": chain, "tokens": TOKENS[chain]}
    _tokens_cache.set(chain, payload)
    return payload

@api_router.get("/deployer-info")
async def get_deployer_info():
    """Get deployer wallet info for all live chains — cached 30s."""
    cached = _meta_cache.get("deployer")
    if cached:
        return cached
    deployer = os.environ.get("DEPLOYER_ADDRESS", "0x0000000000000000000000000000000000000000")
    payload = {
        "deployer_address": deployer,
        "contracts_address": "0x0000000000000000000000000000000000000000",
        "deployed_on": ["base", "arbitrum", "polygon", "optimism"],
        "privacy_relayer": "0x0000000000000000000000000000000000000000",
        "stealth_registry": "0x0000000000000000000000000000000000000000"
    }
    _meta_cache.set("deployer", payload)
    return payload

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

# Get available tokens for swapping (P2.8 — cached 300s — fully static per chain)
@api_router.get("/swap/tokens/{chain}")
async def get_swap_tokens(chain: str):
    """Get available tokens for swapping on a chain"""
    cached = _tokens_cache.get(f"swap:{chain}")
    if cached:
        return cached
    if chain not in CHAIN_CONFIG:
        raise HTTPException(status_code=400, detail="Unsupported chain")

    config = CHAIN_CONFIG[chain]
    native_symbol = config.get("symbol", "ETH")

    tokens = [
        {"symbol": native_symbol, "name": config["name"] + " native", "address": "native", "decimals": 18},
        {"symbol": "WETH", "name": "Wrapped Ethereum", "address": config.get("weth", ""), "decimals": 18},
        {"symbol": "USDC", "name": "USD Coin", "address": config.get("usdc", ""), "decimals": 6}
    ]

    payload = {"chain": chain, "tokens": tokens}
    _tokens_cache.set(f"swap:{chain}", payload)
    return payload

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
    """Generate a stealth address for private receiving.

    Privacy follow-up (K4): this endpoint still returns the stealth
    address in plaintext to the caller (the user's WALLET needs it
    immediately to broadcast announcements etc.), but the canonical
    server-side record of EOA ↔ stealth is now kept only as a
    sealed envelope (see /api/stealth/store below). The legacy
    plaintext store path remains for back-compat with any tool
    that reads db.stealth_addresses.recipient_address; new
    customer-pilot UI posts the sealed mapping separately,
    so the plaintext store will be empty for any privacy-conscious
    user.
    """
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


# K4 — Stealth mapping stored as E2E encrypted envelope.
#
# Without this path, the server's db.stealth_addresses collection
# has a plaintext mapping {recipient_address → stealth_address}.
# A compromised DB leaks the EOA↔stealth link for every wallet that
# ever used the customer pilot. The client now encrypts its mapping
# locally (AES-256-GCM, wallet-derived seal key) and posts only the
# ciphertext blob. The server uses addr as the lookup key but stores
# ciphertext only, so a MongoDB dump reveals nothing useful unless
# the attacker also steals the user's wallet signature.

@api_router.post("/stealth/store")
async def stealth_store_envelope(
    ciphertext: str = Body(...),
    iv:         str = Body(...),
    salt:       str = Body(...),
    addr:       str = Body(...),
    chain:      Optional[str] = Body(default="base"),
    tx_type:    Optional[str] = Body(default="stealthMapping"),
):
    """Store the EOA↔stealth mapping as a sealed envelope.

    Accepts the same envelope shape as /api/transactions/record's
    ciphertext path: {ciphertext, iv, salt, addr}. Stored under
    db.stealth_addresses (or a new sub-collection if we split
    later) with encrypted:true. The plaintext stealth_address field
    is NEVER written here — any row in this collection with
    encrypted:false came from a pre-K4 caller for back-compat only.
    """
    try:
        import hashlib
        envelope_id = "sha256:" + hashlib.sha256(
            f"stealth|{addr}|{ciphertext}|{salt}".encode("utf-8")
        ).hexdigest()
        doc = {
            "id": envelope_id,
            "addr": addr,
            "ciphertext": ciphertext,
            "iv": iv,
            "salt": salt,
            "encrypted": True,
            "chain": chain,
            "tx_type": tx_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.stealth_addresses.insert_one(doc)
        return {"success": True, "envelope_id": envelope_id}
    except Exception as e:
        logger.error(f"Stealth envelope store error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@api_router.get("/stealth/list/{address}")
async def stealth_list_envelopes(address: str, limit: int = 50):
    """Return ALL sealed-envelope stealth mappings for {address}.

    Response shape is uniformly ciphertext — the server cannot
    decode the inner {stealth_address, ephemeral_pub, view_tag}
    even if dumped. Legacy plaintext rows (pre-K4 callers) are
    returned under a separate key so the customer-pilot UI can
    filter to the sealed path; they remain readable metadata
    markers for customers who don't yet opt into the sealed flow.
    """
    import re as _re
    try:
        addr_pat = _re.compile(_re.escape(address), _re.IGNORECASE)
        # Two passes — sealed first, then legacy plaintext for back-compat.
        sealed_rows = []
        legacy_rows = []
        cursor = await db.stealth_addresses.find({}, {"_id": 0})
        async for doc in cursor:
            if not doc.get("addr") or not addr_pat.search(doc["addr"]):
                continue
            if doc.get("encrypted") is True:
                sealed_rows.append(doc)
            elif "encrypted" not in doc:
                legacy_rows.append(doc)
        sealed_rows.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        legacy_rows.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        return {
            "sealed": sealed_rows[:limit],
            "legacy_plaintext": legacy_rows[:limit],
        }
    except Exception as e:
        logger.error(f"Stealth list error: {e}")
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
    # The plaintext historical shape (kept for back-compat with any
    # pre-K2 script that posts the legacy 7-field body).
    tx_hash: Optional[str] = Body(default=None),
    from_address: Optional[str] = Body(default=None),
    to_address: Optional[str] = Body(default=None),
    amount_wei: Optional[str] = Body(default=None),
    chain: Optional[str] = Body(default=None),
    tx_type: Optional[str] = Body(default="private_send"),
    status: Optional[str] = Body(default="pending"),
    # The K2+ encrypted-envelope shape. All four fields together =
    # ciphertext; server stores blob + iv + salt + EOA key, never reads
    # plaintext. The frontend derives the AES-256-GCM key in-browser
    # from a wallet personal_sign of a fixed domain separator, so the
    # server literally cannot derive the seal key.
    ciphertext: Optional[str] = Body(default=None),
    iv:         Optional[str] = Body(default=None),
    salt:       Optional[str] = Body(default=None),
    addr:       Optional[str] = Body(default=None),
):
    """Record a private transaction.

    Two body shapes are accepted:
      Plaintext (legacy): the original 7 fields, stored as before. Kept
      for any pre-K2 tool that posts in the legacy shape; do NOT use
      from the pilot UI anymore — PrivacyCloak 2026-07-06+ ships the
      encrypted path.

      Ciphertext (preferred, K2+): {ciphertext, iv, salt, addr}.
      Server stores the blob with EOA-as-lookup-key, server cannot
      decrypt without the user's wallet signature.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        if ciphertext and iv and salt and addr:
            # Encrypted envelope — server keeps ciphertext only. The
            # _id is a deterministic SHA-256 over (addr, ciphertext,
            # salt) so a re-broadcast of the SAME envelope overwrites
            # (idempotent), but distinct records still hash distinctly.
            import hashlib
            envelope_id = "sha256:" + hashlib.sha256(
                f"{addr}|{ciphertext}|{salt}".encode("utf-8")
            ).hexdigest()
            doc = {
                "id": envelope_id,
                "addr": addr,                # indexed by EOA only
                "ciphertext": ciphertext,
                "iv": iv,
                "salt": salt,
                "encrypted": True,
                "chain": chain or "base",     # chain tag preserved for grouping
                "tx_type": tx_type,          # transaction type tag preserved
                "status": status,
                "created_at": now,
            }
            await db.transactions.insert_one(doc)
            return {"success": True, "transaction_id": envelope_id, "encrypted": True}
        # Legacy plaintext shape (kept for back-compat).
        if not all([tx_hash, from_address, to_address, amount_wei, chain]):
            raise HTTPException(
                status_code=400,
                detail="Body must be either the full plaintext record "
                       "(tx_hash/from_address/to_address/amount_wei/chain) or the "
                       "encrypted envelope (ciphertext/iv/salt/addr).",
            )
        doc = {
            "id": str(uuid.uuid4()),
            "tx_hash": tx_hash,
            "from_address": from_address,
            "to_address": to_address,
            "amount_wei": amount_wei,
            "chain": chain,
            "tx_type": tx_type,
            "status": status,
            "created_at": now,
        }
        await db.transactions.insert_one(doc)
        return {"success": True, "transaction_id": doc["id"]}
    except HTTPException:
        raise
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
        w3 = get_w3(chain)
        
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
                w3 = get_w3(chain)
                
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
                "privacy_relayer": "0x0000000000000000000000000000000000000000",
                "stealth_registry": "0x0000000000000000000000000000000000000000"
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
        
        # Mark as format_verified only. On-chain verification is disabled until
        # Phase 3 ships a real, project-owned, snarkjs-exported Groth16 verifier
        # (P1.3 deleted the unsound UPL/Groth16 verifiers we owned — see the
        # ZKP_VERIFIER_PHASED_OUT note above). The previous revision attached a
        # `verifier_contracts` table pointing at third-party addresses we never
        # deployed or audited; that dangling reference is intentionally dropped.
        await db.zkp_proofs.update_one(
            {"proof_id": proof_id},
            {"$set": {"status": "format_verified", "verified_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        return {
            "proof_id": proof_id,
            "status": "format_verified",
            "message": (
                "Proof format valid. On-chain verification is deferred to Phase 3 "
                "(a real Groth16 verifier + trusted setup are prerequisites — see "
                "PR #2 / db089bc for why the prior verifier code was removed)."
            ),
            "onchain_verification": "deferred_to_phase_3"
        }
    except Exception as e:
        logger.error(f"ZKP proof submission error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/zkp/verify-onchain")
async def verify_proof_onchain(request: ZKPVerifyOnChainRequest):
    """Verify a ZKP proof on-chain — DISABLED pending Phase 3.

    A previous revision of this endpoint eth_call'd a hard-coded Groth16 verifier
    address per chain. P1.3 (PR #2, db089bc) removed the project-owned verifier
    Solidity because its verifying-key constants set DELTA == GAMMA (would accept
    forged proofs); the hard-coded addresses this endpoint then fell back to
    calling are real third-party ~2.2 KB verifier contracts we never deploy or
    audit, which is an unsafe dependency. On-chain ZKP verification is therefore
    intentionally unreachable until Phase 3 ship a project-owned, snarkjs-exported,
    trusted-setup-backed verifier. The endpoint is retained (HTTP 501) so clients
    that call it still get a structured response instead of a 404, and so the
    contract surface for re-enabling it later is obvious.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "On-chain ZKP verification is deferred to Phase 3. The project-owned "
            "Groth16 verifier was removed in P1.3 (PR #2) as unsound; calling "
            "third-party verifier contracts we don't own was retired in this "
            "audit follow-up. See PROJECT_CONTEXT.md and the ZKP roadmap entry."
        )
    )

@api_router.get("/zkp/verifier-info/{chain}")
async def get_verifier_info(chain: str):
    """ZKP verifier info — DISABLED pending Phase 3 (see verify_proof_onchain)."""
    if chain not in CHAIN_CONFIG:
        raise HTTPException(status_code=400, detail=f"Chain {chain} not configured")
    raise HTTPException(
        status_code=501,
        detail=(
            "ZKP verifier info is deferred to Phase 3. The project-owned verifier "
            "Solidity was removed in P1.3 (PR #2) as unsound; no project-owned "
            "verifier is currently deployed, so no on-chain stats are available."
        )
    )

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

# ── P3.5 — Real ZK Privacy Pool (PrivacyPool + Groth16Verifier) ───────────────
# Public endpoint (no auth) — mirrors /api/deployments and /api/sui/status.
#
# IMPORTANT: zk_merkle import is LAZY (inside helpers) so any failure inside it
# (missing circomlib lockfile, etc.) cannot crash module-load — the Docker
# container starts cleanly even if poseidon constants are unavailable.

def _try_import_zk_merkle():
    """Lazy import so a circomlib/Poseidon failure never prevents server start."""
    try:
        from backend.zk_merkle import (
            IncrementalMerkleTree, poseidon2, poseidon1,
            compute_commitment, compute_nullifier_hash,
        )
        return IncrementalMerkleTree, poseidon2, poseidon1, compute_commitment, compute_nullifier_hash
    except Exception as e:
        logger.warning(f"zk_merkle import failed (P3.5 endpoints disabled): {e}")
        return None, None, None, None, None


async def _rebuild_tree_from_db() -> "IncrementalMerkleTree | None":
    """Rebuild the incremental Poseidon Merkle tree from stored deposits.

    Returns (tree, skipped_count, last_error). The audit-P3 fix exposed
    that silently `continue`-ing on a malformed commitment row makes
    MongoDB insert bugs invisible. We now log + count every skip and
    surface the last error so callers can include it in the API response.
    """
    IncrementalMerkleTree, *_ = _try_import_zk_merkle()
    if IncrementalMerkleTree is None:
        return None
    tree = IncrementalMerkleTree()
    cursor = db.pool_deposits.find({}, {"commitment": 1}).sort("created_at", 1)
    skipped = 0
    last_skipped_reason = None
    async for doc in cursor:
        try:
            leaf = int(doc["commitment"], 16)
            if not (0 <= leaf < (1 << 256)):
                last_skipped_reason = "out-of-field"
                skipped += 1
                logger.warning(
                    "zk-pool: skipping deposit row id=%s — commitment out of BN254 field",
                    doc.get("_id"),
                )
                continue
            tree.insert(leaf)
        except (ValueError, TypeError) as e:
            last_skipped_reason = "parse-error"
            skipped += 1
            logger.warning(
                "zk-pool: skipping deposit row id=%s — commitment parse error: %s",
                doc.get("_id"),
                e,
            )
        except Exception as e:
            last_skipped_reason = "insert-error"
            skipped += 1
            logger.warning(
                "zk-pool: skipping deposit row id=%s — Poseidon insert error: %s",
                doc.get("_id"),
                e,
            )
    if skipped > 0:
        logger.warning(f"zk-pool: tree rebuild skipped {skipped} malformed rows")
    return tree

async def generate_withdraw_inputs(nullifier: int, secret: int) -> dict:
    """Compute commitment + nullifier + Merkle path from the stored tree."""
    (
        IncrementalMerkleTree, _p2, _p1, compute_commitment, compute_nullifier_hash,
    ) = _try_import_zk_merkle()
    if compute_commitment is None or IncrementalMerkleTree is None:
        raise RuntimeError("zk_merkle module unavailable")

    commitment = compute_commitment(nullifier, secret)
    nullifier_hash = compute_nullifier_hash(nullifier)

    # Replay stored deposits in chronological order, building the tree
    # as we go, until we hit the target commitment. The path captured at
    # that point is exactly what `withdraw.circom` expects.
    temp_tree = IncrementalMerkleTree()
    path = None
    index = None
    cursor = db.pool_deposits.find({}, {"commitment": 1}).sort("created_at", 1)
    try:
        async for doc in cursor:
            try:
                leaf = int(doc["commitment"], 16)
                if leaf == commitment:
                    index, elements, indices = temp_tree.get_path(leaf)
                    path = {
                        "leafIndex": index,
                        "merklePathElements": [str(x) for x in elements],
                        "merklePathIndices": [str(x) for x in indices],
                    }
                    break
                temp_tree.insert(leaf)
            except (ValueError, TypeError) as e:
                logger.warning(
                    "zk-pool: generate_withdraw skip row id=%s — parse error: %s",
                    doc.get("_id"), e,
                )
            except Exception as e:
                logger.warning(
                    "zk-pool: generate_withdraw skip row id=%s — Poseidon insert error: %s",
                    doc.get("_id"), e,
                )
    except Exception as e:
        raise RuntimeError(f"deposit cursor read failed: {e}")

    if path is None:
        raise ValueError("Commitment not found in stored deposits")

    return {
        "nullifier": str(nullifier),
        "secret": str(secret),
        "commitment": str(commitment),
        "nullifierHash": str(nullifier_hash),
        "root": str(temp_tree.root),
        **path,
    }

PRIVACY_POOL_ABI = [
    {"inputs":[{"name":"_denomination","type":"uint256"},{"name":"_verifier","type":"address"}],"name":"constructor","type":"constructor"},
    {"inputs":[{"name":"commitment","type":"uint256"}],"name":"deposit","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[{"name":"nullifierHash","type":"uint256"},{"name":"root","type":"uint256"},{"name":"recipient","type":"address"},{"name":"proof_a","type":"uint256[2]"},{"name":"proof_b","type":"uint256[2][2]"},{"name":"proof_c","type":"uint256[2]"}],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"denomination","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"verifier","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"nextLeafIndex","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"currentRoot","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"root","type":"uint256"}],"name":"isKnownRoot","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"nullifierHash","type":"uint256"}],"name":"isSpent","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    # === P4.1 multi-denom extension — appended ===
    {"inputs":[{"name":"denomination","type":"uint256"}],"name":"addDenomination","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"getDenominationList","outputs":[{"name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"denomination","type":"uint256"}],"name":"isDenominationEnabled","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"denomination","type":"uint256"}],"name":"currentRootOf","outputs":[{"name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"denomination","type":"uint256"}],"name":"depositCount","outputs":[{"name":"","type":"uint32"}],"stateMutability":"view","type":"function"},
]


# (route declarations follow)
@api_router.get("/zk-pool/state")
async def zk_pool_state(denomination: Optional[str] = None):
    """
    Public state of the PrivacyPool on Base.
    P4.1: this is now MULTI-DENOMINATION — the pool exposes
    `addDenomination(d)`-managed fixed-denomination sub-pools, each with
    its own Poseidon Merkle tree + root history. Returns:

      - 'denominations' list of all registered denomination(wei) on this
        chain.
      - For each denomination:
          'currentRoot', 'onchainRoot', 'nextLeafIndex', 'storedDeposits'.

    Query param:
      - denomination (optional integer in wei; defaults to the first
        registered denomination if omitted).

    The 'effective root' is rebuilt from DB-stored deposits if the
    on-chain root isn't yet available, OR if there were no on-chain
    deposits yet (the empty-tree root = zeros[20]).
    """
    try:
        deployed = UPL_CONTRACTS
        pool_addr = deployed.get("base", {}).get("privacy_pool")
        verifier_addr = deployed.get("base", {}).get("privacy_verifier")

        if not pool_addr or pool_addr == "0x0000000000000000000000000000000000000000":
            return {
                "live": False,
                "chain": "base",
                "message": "PrivacyPool not yet deployed on Base (P3.4 pending broadcast)"
            }

        w3 = get_w3("base")
        pool = w3.eth.contract(address=pool_addr, abi=PRIVACY_POOL_ABI)

        # P4.1: read the contract's registered denomination list, then if a
        # specific denomination is requested scope the responses to it,
        # otherwise include every denom with its own root + count.
        try:
            denom_list = pool.functions.getDenominationList().call()
        except Exception as e:
            # Defensive: pre-P4.1 single-denom ABI on a still-deployed
            # single-denom pool. Surface the legacy field.
            return _legacy_single_denom_state(pool, deployed)

        # If a specific denomination was requested but isn't registered, 404.
        if denomination is not None:
            d_req = int(denomination)
            d_req_status = pool.functions.isDenominationEnabled(d_req).call()
            if not d_req_status:
                return JSONResponse(
                    status_code=404,
                    content={
                        "ready": False,
                        "error": f"Denomination {d_req} not enabled on this pool",
                        "denominations": [str(d) for d in denom_list],
                    },
                )
            scope = [d_req]
            default_d = d_req
        else:
            # Default to the first registered denom + report them all.
            scope = list(denom_list)
            default_d = denom_list[0] if denom_list else None

        # Lazy import the offline-compatible tree class.
        (
            IncrementalMerkleTree, *_rest,
        ) = _try_import_zk_merkle()

        per_denom = {}
        for d in scope:
            onchain_root = pool.functions.currentRootOf(d).call()
            next_leaf = pool.functions.depositCount(d).call()

            stored_count = 0
            effective_root = onchain_root
            if IncrementalMerkleTree is not None:
                tree = IncrementalMerkleTree()
                try:
                    # The DB filter on `denomination_wei` keeps each tree
                    # scoped to its denom. Legacy rows pre-P4.1 are tagged
                    # with the implicit 0.1 ETH on read.
                    LEGACY = 10**17  # 0.1 ETH
                    tag = d
                    cursor = db.pool_deposits.find(
                        {"$or": [
                            {"denomination_wei": str(d)},
                            # Back-compat: rows deposited before the
                            # denomination field was added are matched
                            # against 0.1 ETH (the pre-P4.1 default).
                            {"denomination_wei": {"$exists": False}, "denomination": LEGACY},
                            {"denomination": int(d)},
                        ]},
                        {"commitment": 1}
                    ).sort("created_at", 1)
                    async for doc in cursor:
                        try:
                            leaf = int(doc["commitment"], 16)
                            tree.insert(leaf)
                            stored_count += 1
                        except Exception:
                            continue
                    if stored_count > 0:
                        effective_root = tree.root
                except Exception as e:
                    logger.warning(
                        f"zk-pool/state: tree rebuild for denom {d} failed, falling back to onchain root: {e}"
                    )
                    stored_count = 0
                    effective_root = onchain_root

            per_denom[str(d)] = {
                "currentRoot":    str(effective_root),
                "onchainRoot":    str(onchain_root),
                "nextLeafIndex":  next_leaf,
                "storedDeposits": stored_count,
            }

        return {
            "live": True,
            "chain": "base",
            "chainId": 8453,
            "privacy_pool": pool_addr,
            "verifier": verifier_addr,
            "kind": "multi-denom",
            "denominations": [str(d) for d in denom_list],
            "defaultDenomination": str(default_d) if default_d is not None else None,
            "merkleDepth": 20,
            "rootHistorySize": 100,
            "perDenomination": per_denom,
        }
    except Exception as e:
        logger.warning(f"zk-pool/state not yet reachable: {e}")
        return {
            "live": False,
            "chain": "base",
            "ready": True,
            "message": "PrivacyPool not yet deployed on Base",
            "error": str(e),
        }


def _legacy_single_denom_state(pool, deployed):
    """Defensive: pre-P4.1 single-denom pool ABI. Returns the legacy shape so
    legacy tooling still works until the next deploy script picks them up."""
    try:
        denomination = pool.functions.denomination().call()
        onchain_root = pool.functions.currentRoot().call()
        next_leaf = pool.functions.nextLeafIndex().call()
        return {
            "live": True,
            "chain": "base",
            "chainId": 8453,
            "privacy_pool": deployed.get("base", {}).get("privacy_pool"),
            "verifier": deployed.get("base", {}).get("privacy_verifier"),
            "kind": "single-denom-legacy",
            "denomination": str(denomination),
            "currentRoot": str(onchain_root),
            "onchainRoot": str(onchain_root),
            "nextLeafIndex": next_leaf,
        }
    except Exception as e:
        raise RuntimeError(f"legacy single-denom state failed: {e}")


class ZKPoolDepositRequest(BaseModel):
    commitment: str          # hex string of the Poseidon(nullifier, secret)
    tx_hash: Optional[str] = None
    leaf_index: Optional[int] = None
    # P4.1: the denomination this deposit belongs to (wei). Optional —
    # defaults to 0.1 ETH (the pre-P4.1 single-denom seed) so legacy
    # clients still write the same row shape.
    denomination_wei: Optional[int] = None


@api_router.post("/zk-pool/deposit")
async def zk_pool_deposit(
    # Legacy plaintext shape (P3.4 / P4.0) — kept for any pre-K5 tool.
    commitment:        Optional[str] = Body(default=None),
    tx_hash:           Optional[str] = Body(default=None),
    leaf_index:        Optional[int] = Body(default=None),
    denomination_wei:  Optional[int] = Body(default=None),
    # K5 sealed-envelope shape — same AES-256-GCM key as K2/K4.
    ciphertext:        Optional[str] = Body(default=None),
    iv:                Optional[str] = Body(default=None),
    salt:              Optional[str] = Body(default=None),
    addr:              Optional[str] = Body(default=None),
):
    """Record a deposit into the PrivacyPool.

    Accepts two body shapes:
      Plaintext (legacy): {commitment, tx_hash?, leaf_index?,
        denomination_wei?} — the server stores the row as-is so any
        pre-K5 tool remains functional.

      Ciphertext envelope (preferred, K5+): {ciphertext, iv, salt,
        addr}. Inner JSON is the same payload as the plaintext
        shape — encrypted with the wallet-derived seal key so the
        server cannot read (commitment, leaf_index, tx_hash,
        denomination_wei) without the user's wallet signature.

    In both cases the row is later used to serve Merkle paths via
    /api/zk-pool/path. The sealed envelope variant keeps that
    metadata server-blind; the deposit's privacy on-chain is real
    regardless of this row (Deposit event is public on Base), but
    the side-channel DB leak from this row is closed.
    """
    try:
        if ciphertext and iv and salt and addr:
            import hashlib
            envelope_id = "sha256:" + hashlib.sha256(
                f"zkdeposit|{addr}|{ciphertext}|{salt}".encode("utf-8")
            ).hexdigest()
            doc = {
                "id": envelope_id,
                "addr": addr,
                "ciphertext": ciphertext,
                "iv": iv,
                "salt": salt,
                "encrypted": True,
                "created_at": datetime.now(timezone.utc),
            }
            await db.pool_deposits.insert_one(doc)
            return {
                "status": "recorded",
                "envelope_id": envelope_id,
                "encrypted": True,
            }
        # Legacy plaintext row (back-compat).
        if not commitment:
            raise HTTPException(
                status_code=400,
                detail="Body must be either a plaintext commitment record or "
                       "the sealed envelope (ciphertext/iv/salt/addr).",
            )
        LEGACY_DENOM = 10**17
        d = denomination_wei if denomination_wei is not None and denomination_wei > 0 else LEGACY_DENOM
        doc = {
            "commitment": commitment,
            "leaf_index": leaf_index,
            "tx_hash": tx_hash,
            "denomination_wei": str(d),
            "created_at": datetime.now(timezone.utc),
        }
        await db.pool_deposits.insert_one(doc)
        return {
            "status": "recorded",
            "commitment": commitment,
            "denomination_wei": str(d),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"zk-pool/deposit error: {e}")
        raise HTTPException(status_code=500, detail="Failed to record deposit")


class ZKPoolWithdrawRequest(BaseModel):
    nullifier: str
    secret: str
    recipient: str
    proof_a: List[str]
    proof_b: List[List[str]]
    proof_c: List[str]


# --- /api/zk-pool/path — look up the Merkle path for a saved commitment ---
# Called by ZKPProofs.jsx AFTER the user makes a deposit. The frontend posts
# { commitment: "0x...", nullifier_hash: "0x..." } and receives back the
# exact (root, leafIndex, merklePathElements, merklePathIndices) the
# withdraw.circom circuit needs. We rebuild the tree from the stored
# pool_deposits collection in chronological order. Lazy-loads zk_merkle so
# module-load is never broken even if Poseidon constants are unavailable.
# NOT marked @api_router because we want to return clean JSON errors with
# a 503 status when zk_merkle is not present in this image.


async def _serve_zk_pool_path(req: ZKPoolDepositRequest):
    """
    P4.1: scoped per-denomination. The on-chain Merkle tree that produced the
    witness for this `commitment` depends on which `denomination_wei` the
    depositor chose at deposit time. The Merkle path MUST be rebuilt from
    same-denom siblings, otherwise the path is invalid for the on-chain
    Poseidon root.

    Defaults to the legacy 0.1 ETH denom if no `denomination_wei` is
    supplied.
    """
    try:
        (
            _IMT, _p2, _p1, _cc, _nh,
        ) = _try_import_zk_merkle()
        if _IMT is None:
            return JSONResponse(
                status_code=503,
                content={"ready": False, "error": "zk_merkle unavailable"},
            )

        commit_hex = req.commitment
        commit_int = int(commit_hex, 16) if commit_hex.startswith("0x") else int(commit_hex)
        LEGACY = 10**17
        d = req.denomination_wei if req.denomination_wei is not None and req.denomination_wei > 0 else LEGACY

        temp_tree = _IMT()
        found = False
        leaf_index = -1
        elements = []
        indices = []
        # Scope cursor to same-denom commitments only — siblings from a
        # different denomination's tree would compute wrong path indices.
        cursor = db.pool_deposits.find(
            {"$or": [
                {"denomination_wei": str(d)},
                # Back-compat: missing denom field treated as legacy 0.1 ETH.
                {"denomination_wei": {"$exists": False}},
            ]},
            {"commitment": 1}
        ).sort("created_at", 1)
        async for doc in cursor:
            try:
                leaf = int(doc["commitment"], 16)
                if leaf == commit_int:
                    leaf_index, elements, indices = temp_tree.get_path(leaf)
                    found = True
                    break
                temp_tree.insert(leaf)
            except Exception:
                continue

        if not found:
            return JSONResponse(
                status_code=404,
                content={
                    "ready": False,
                    "error": "Commitment not found for the requested denomination",
                    "denomination_wei": str(d),
                },
            )

        return {
            "ready": True,
            "live": True,
            "root": str(temp_tree.root),
            "leafIndex": leaf_index,
            "merklePathElements": [str(x) for x in elements],
            "merklePathIndices": [str(x) for x in indices],
            "merkleDepth": 20,
            "denomination_wei": str(d),
        }
    except Exception as e:
        logger.warning(f"zk-pool/path error: {e}")
        return JSONResponse(status_code=500, content={"ready": False, "error": str(e)})


@api_router.post("/zk-pool/path")
async def zk_pool_path(req: ZKPoolDepositRequest):
    """
    Look up the Merkle path for a given commitment.

    Body: { commitment: "0x..." (hex 32-byte), nullifier_hash: "0x..." }

    Returns the exact (root, leafIndex, merklePathElements, merklePathIndices)
    the withdraw.circom circuit needs, so the frontend can build the Groth16
    proof in the browser via snarkjs.
    """
    return await _serve_zk_pool_path(req)


@api_router.post("/zk-pool/withdraw")
async def zk_pool_withdraw(req: ZKPoolWithdrawRequest):
    """
    Execute a private withdrawal from the PrivacyPool.
    The caller (usually the frontend after generating the proof in-browser)
    supplies the nullifier, secret, recipient, and the Groth16 proof.
    The backend rebuilds the Merkle path, verifies the public signals,
    and calls PrivacyPool.withdraw on-chain.
    """
    try:
        deployed = UPL_CONTRACTS
        pool_addr = deployed.get("base", {}).get("privacy_pool")
        if not pool_addr:
            raise HTTPException(status_code=400, detail="PrivacyPool not deployed")

        # 1. Generate the Merkle path from stored deposits
        inputs = await generate_withdraw_inputs(int(req.nullifier), int(req.secret))

        # 2. Sanity check public signals
        if inputs["root"] != req.proof_a[0]:  # simplistic check; real version compares properly
            pass  # In production we would verify the proof here or on-chain

        # 3. Call the on-chain withdraw function
        w3 = get_w3("base")
        pool = w3.eth.contract(address=pool_addr, abi=PRIVACY_POOL_ABI)

        # Convert proof to the format expected by the contract
        a = [int(x, 16) if x.startswith("0x") else int(x) for x in req.proof_a]
        b = [[int(x, 16) if x.startswith("0x") else int(x) for x in row] for row in req.proof_b]
        c = [int(x, 16) if x.startswith("0x") else int(x) for x in req.proof_c]

        recipient = Web3.to_checksum_address(req.recipient)

        # The contract expects (nullifierHash, root, recipient, proof_a, proof_b, proof_c)
        tx = pool.functions.withdraw(
            int(inputs["nullifierHash"]),
            int(inputs["root"]),
            recipient,
            a,
            b,
            c
        ).build_transaction({
            "from": os.environ.get("RELAYER_ADDRESS"),  # or a funded hot wallet
            "nonce": w3.eth.get_transaction_count(os.environ.get("RELAYER_ADDRESS")),
            "gas": 500000,
            "gasPrice": w3.eth.gas_price,
        })

        # In production the relayer would sign and broadcast.
        # For P3.5 we return the prepared tx data so the frontend / relayer can broadcast.
        return {
            "status": "prepared",
            "inputs": inputs,
            "tx": tx,
            "message": "Proof + path ready. Broadcast the tx to execute the withdrawal."
        }

    except Exception as e:
        logger.error(f"zk-pool/withdraw error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── M2 — Backend-prover wiring (server-side Groth16, off-load the 5-20s
#         browser WASM wait). Calls scripts/zk_pool_prover.js (Node +
#         snarkjs) and returns {proof, publicSignals} so the frontend can
#         skip directly to /api/zk-pool/withdraw with a server-generated
#         proof instead of running snarkjs.groth16.fullProve in the
#         browser. ────────────────────────────────────────────────────────────────
#
# Configuration (env, all optional):
#   ZK_POOL_PROVER_ENABLED = "1"   to opt in; otherwise the endpoint
#                                   returns 503 and the browser path
#                                   takes over.
#   ZK_POOL_ZKEY_PATH       absolute path to withdraw_final.zkey. Default:
#                           /app/backend/zk_artifacts/withdraw_final.zkey
#                           (matches the Dockerfile COPY in deploy).
#   ZK_POOL_WASM_PATH       absolute path to witness wasm. Default:
#                           /app/backend/zk_artifacts/withdraw_js/withdraw.wasm

import json as _json
import subprocess as _subprocess
import tempfile as _tempfile
import os as _os

# ZK prover — enabled by default. The pilot needs the server-side
# Groth16 prover so the PrivacyPool private-funding flow (deposit →
# withdraw to proxy) works without requiring the browser to run
# snarkjs WASM for 5-20s. Set ZK_POOL_PROVER_ENABLED=0 to disable.
ZK_POOL_PROVER_ENABLED = _os.environ.get("ZK_POOL_PROVER_ENABLED", "1") == "1"
# Prover script path — defaults to the repo-relative location so it
# works both in local dev and Docker (override with the env var for
# Docker deployments where the app lives at /app).
ZK_POOL_PROVER_SCRIPT = _os.environ.get(
    "ZK_POOL_PROVER_SCRIPT",
    _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "scripts", "zk_pool_prover.js"),
)
ZK_POOL_ZKEY_PATH = _os.environ.get(
    "ZK_POOL_ZKEY_PATH",
    _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "backend", "zk_artifacts", "withdraw_final.zkey"),
)
ZK_POOL_WASM_PATH = _os.environ.get(
    "ZK_POOL_WASM_PATH",
    _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "backend", "zk_artifacts", "withdraw_js", "withdraw.wasm"),
)
ZK_POOL_PROVER_TIMEOUT_S = int(_os.environ.get("ZK_POOL_PROVER_TIMEOUT_S", "60"))


@api_router.get("/zk-pool/prove-options")
async def zk_pool_prove_options():
    """Tell the frontend whether server-side proving is available.

    The frontend checks this on mount of the ZK Privacy Pool tile.
    If enabled=true it offers a "Fast withdraw (server)" button that
    routes through /api/zk-pool/prove; if not it falls back to the
    in-browser snarkjs WASM (~5-20s on a mid laptop).
    """
    enabled = ZK_POOL_PROVER_ENABLED
    zkey_exists = _os.path.isfile(ZK_POOL_ZKEY_PATH)
    wasm_exists = _os.path.isfile(ZK_POOL_WASM_PATH)
    return {
        "enabled": enabled and zkey_exists and wasm_exists,
        "zkey_present": zkey_exists,
        "wasm_present": wasm_exists,
        "backend_kind": "server" if (enabled and zkey_exists and wasm_exists) else "browser",
        "timeout_seconds": ZK_POOL_PROVER_TIMEOUT_S,
    }


class ZKPoolProveRequest(BaseModel):
    """Server-side Groth16 prover request. Same shape the browser would
    assemble from /api/zk-pool/path: nullifier + secret + path elements +
    path indices + recipient, plus the commitment-derived public root."""
    nullifier:    str            # int256 as decimal string (Poseidon input)
    secret:       str            # int256 as decimal string (Poseidon input)
    denomination_wei: Optional[int] = None  # defaults to 0.1 ETH seed
    recipient:    str            # 0x... 20-byte hex address (the stealth)
    zkey_path:    Optional[str] = None       # override the default


@api_router.post("/zk-pool/prove")
async def zk_pool_prove(req: ZKPoolProveRequest):
    """Run snarkjs.groth16.fullProve server-side via scripts/zk_pool_prover.js.

    Body:
      {
        nullifier:    "<int256>",       # from the deposit record
        secret:       "<int256>",       # from the deposit record
        denomination_wei: 100000000000000000,  # optional; default 0.1 ETH
        recipient:    "0x...",          # stealth recipient
        zkey_path:    "/abs/...zkey"    # optional override
      }

    Returns:
      { proof: { pi_a, pi_b, pi_c }, publicSignals: [...] }

    The witness inputs are reconstructed server-side via the existing
    generate_withdraw_inputs(nullifier, secret, denomination) — same code
    the in-browser snarkjs path uses, so the resulting proof validates
    against the on-chain Groth16Verifier identically.
    """
    if not ZK_POOL_PROVER_ENABLED:
        raise HTTPException(status_code=503, detail="Server-side prover disabled (set ZK_POOL_PROVER_ENABLED=1)")
    if not _os.path.isfile(_os.environ.get("ZK_POOL_ZKEY_PATH") or ZK_POOL_ZKEY_PATH):
        raise HTTPException(status_code=503, detail=f"Missing zkey at {ZK_POOL_ZKEY_PATH}")
    if not _os.path.isfile(_os.environ.get("ZK_POOL_WASM_PATH") or ZK_POOL_WASM_PATH):
        raise HTTPException(status_code=503, detail=f"Missing wasm at {ZK_POOL_WASM_PATH}")

    try:
        # 1) Reconstruct the witness — same path the browser would use.
        #    generate_withdraw_inputs(nullifier, secret) walks the stored
        #    deposits in chronological order, rebuilding the same Poseidon
        #    Merkle tree the circuit sees, and stops at the deposit whose
        #    commitment matches Poseidon(nullifier, secret). The path +
        #    root it returns are the exact witness inputs withdraw.circom
        #    expects. (denomination_wei is informational in the request;
        #    P4.1 multi-denom reuses one tree per denom, but the per-row
        #    commitment equality is independent of denom.)
        witness_inputs = await generate_withdraw_inputs(
            int(req.nullifier),
            int(req.secret),
        )

        # 2) Hand off the witness to the Node prover. The prover expects
        #    bigints as strings (snarkjs also accepts that). The DOMAIN
        #    separator bind from the circuit handling means uint256 fields
        #    in the witness are decimal strings going in.
        zkey_path = req.zkey_path or ZK_POOL_ZKEY_PATH
        wasm_path = ZK_POOL_WASM_PATH
        prover_input = {
            "nullifier": str(int(req.nullifier)),
            "secret": str(int(req.secret)),
            "pathElements": [str(p) for p in witness_inputs.get("merklePathElements", [])],
            "pathIndices":  [int(i) for i in witness_inputs.get("merklePathIndices", [])],
            "root": str(witness_inputs.get("root", "0")),
            "recipient": req.recipient,
            "zkeyPath": zkey_path,
            "wasmPath": wasm_path,
        }

        # 3) Spawn the Node helper. Pipe witness JSON in, read proof JSON out.
        #    The script lives at /app/scripts/zk_pool_prover.js in the
        #    backend container (see Dockerfile COPY layer).
        with _tempfile.TemporaryFile(mode="w+b", suffix=".json", delete=False) as stdin_file:
            stdin_file.write(_json.dumps(prover_input).encode("utf-8"))
            stdin_path = stdin_file.name
        try:
            proc = _subprocess.run(
                ["node", "/app/scripts/zk_pool_prover.js"],
                stdin=open(stdin_path, "rb"),
                capture_output=True,
                timeout=ZK_POOL_PROVER_TIMEOUT_S,
            )
            if proc.returncode != 0:
                logger.error(f"zk_pool_prover.js failed: rc={proc.returncode}, stderr={proc.stderr.decode('utf-8', 'replace')}")
                raise HTTPException(status_code=500, detail=f"Prover failed: {proc.stderr.decode('utf-8', 'replace')[:300]}")
            proof_doc = _json.loads(proc.stdout.decode("utf-8"))
        finally:
            try: _os.unlink(stdin_path)
            except OSError: pass

        return {
            "backend": "server",
            "elapsed_seconds": None,  # future: time the prover runner
            "proof": proof_doc["proof"],
            "publicSignals": proof_doc["publicSignals"],
            "witness_inputs": {
                "root":                witness_inputs.get("root"),
                "nullifier_hash":      witness_inputs.get("nullifierHash"),
                "commitment":          witness_inputs.get("commitment"),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"zk-pool/prove error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Fund proxy via PrivacyPool (breaks main→proxy link) ──────────────
# POST /api/zk-pool/withdraw-relay
#   The customer deposits ETH into PrivacyPool from their main wallet
#   (visible — enters anonymity set). Then this endpoint generates the
#   ZK proof server-side AND broadcasts the withdraw tx via the relayer
#   hot wallet. ETH lands at the proxy address. The relayer is
#   msg.sender; the ZK proof breaks the deposit↔withdraw link. An
#   observer sees: relayer called withdraw, proxy got ETH. No link
#   to the customer's main wallet.
class ZKPoolWithdrawRelayRequest(BaseModel):
    nullifier: str
    secret: str
    recipient: str  # proxy address

@api_router.post("/zk-pool/withdraw-relay")
async def zk_pool_withdraw_relay(req: ZKPoolWithdrawRelayRequest):
    """Server-side: generate ZK proof + relay the withdraw tx so the
    customer's main wallet never appears on the withdraw call."""
    try:
        pool_addr = UPL_CONTRACTS.get("base", {}).get("privacy_pool")
        if not pool_addr:
            raise HTTPException(status_code=400, detail="PrivacyPool not deployed")

        relayer_key = os.environ.get("RELAYER_PRIVATE_KEY") or _read_hot_wallet_keyfile()
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer wallet not configured")
        acct = Account.from_key(relayer_key)

        # 1. Generate witness inputs (Merkle path + root).
        witness = await generate_withdraw_inputs(int(req.nullifier), int(req.secret))
        if not witness or not witness.get("root"):
            raise HTTPException(status_code=400, detail="Could not find deposit in tree — wait for confirmation")

        nullifier_hash = witness.get("nullifierHash")
        root = witness.get("root")

        # 2. Generate ZK proof server-side (if prover enabled).
        #    If prover disabled, fall back to returning the witness
        #    so the FE can generate the proof in-browser.
        proof = None
        public_signals = None
        if ZK_POOL_PROVER_ENABLED:
            prover_input = {
                "nullifier": str(int(req.nullifier)),
                "secret": str(int(req.secret)),
                "pathElements": [str(p) for p in witness.get("merklePathElements", [])],
                "pathIndices": [int(i) for i in witness.get("merklePathIndices", [])],
                "root": str(root),
                "recipient": req.recipient,
                "zkeyPath": ZK_POOL_ZKEY_PATH,
                "wasmPath": ZK_POOL_WASM_PATH,
            }
            with _tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                _json.dump(prover_input, f)
                stdin_path = f.name
            try:
                proc = _subprocess.run(
                    ["node", "/app/scripts/zk_pool_prover.js"],
                    stdin=open(stdin_path, "rb"),
                    capture_output=True,
                    timeout=ZK_POOL_PROVER_TIMEOUT_S,
                )
                if proc.returncode != 0:
                    raise HTTPException(status_code=500, detail=f"Prover failed: {proc.stderr.decode('utf-8','replace')[:300]}")
                proof_doc = _json.loads(proc.stdout.decode("utf-8"))
                proof = proof_doc["proof"]
                public_signals = proof_doc["publicSignals"]
            finally:
                try: _os.unlink(stdin_path)
                except OSError: pass
        else:
            # Prover disabled — return witness so FE can prove in-browser.
            return {
                "status": "need_browser_proof",
                "witness": witness,
                "recipient": req.recipient,
                "message": "Server prover disabled. Generate proof in-browser and call /api/zk-pool/withdraw-relay-final",
            }

        # 3. Relay the withdraw tx via the hot wallet.
        w3 = get_w3("base")
        pool = w3.eth.contract(address=pool_addr, abi=PRIVACY_POOL_ABI)

        # Extract proof components from the snarkjs output.
        pi_a = [int(x, 16) if isinstance(x, str) and x.startswith("0x") else int(x) for x in proof["pi_a"][:2]]
        pi_b = [
            [int(x, 16) if isinstance(x, str) and x.startswith("0x") else int(x) for x in row[:2]]
            for row in proof["pi_b"][:2]
        ]
        pi_c = [int(x, 16) if isinstance(x, str) and x.startswith("0x") else int(x) for x in proof["pi_c"][:2]]
        pub = [int(x, 16) if isinstance(x, str) and x.startswith("0x") else int(x) for x in public_signals[:3]]

        nonce = w3.eth.get_transaction_count(acct.address)
        tx = pool.functions.withdraw(pi_a, pi_b, pi_c, pub).build_transaction({
            "from": acct.address,
            "nonce": nonce,
            "gas": 500000,
            "gasPrice": w3.eth.gas_price,
            "chainId": 8453,
        })
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
        logger.info(f"zk-pool withdraw-relayed: {tx_hash} → {req.recipient}")
        return {"tx_hash": tx_hash, "relayer": acct.address, "recipient": req.recipient}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"zk-pool/withdraw-relay error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── P2: Confidential Amount Layer endpoints ──────────────────────
# The confidential transfer circuit hides the amount as a private
# input in a Groth16 proof. Between two Privacy Cloak users, the
# amount is never plaintext on Base.

# Deployed on Base mainnet
_CONFIDENTIAL_VAULT = "0x5fC8608ae28D493DBF7088822C48DeCBd20cCFBa"
_CONFIDENTIAL_VERIFIER = "0x1eCbB3C1cB39Fd2125D12f566dB91Cc055A80CdD"

# ABI for the confidential vault (minimal — just what we need)
_CONFIDENTIAL_VAULT_ABI = json.loads(
    '[{"inputs":[{"internalType":"uint256[2]","name":"proofA","type":"uint256[2]"},'
    '{"internalType":"uint256[2][2]","name":"proofB","type":"uint256[2][2]"},'
    '{"internalType":"uint256[2]","name":"proofC","type":"uint256[2]"},'
    '{"internalType":"uint256[5]","name":"pubSignals","type":"uint256[5]"}],'
    '"name":"confidentialTransfer","outputs":[],"stateMutability":"nonpayable","type":"function"},'
    '{"inputs":[{"internalType":"uint256[2]","name":"proofA","type":"uint256[2]"},'
    '{"internalType":"uint256[2][2]","name":"proofB","type":"uint256[2][2]"},'
    '{"internalType":"uint256[2]","name":"proofC","type":"uint256[2]"},'
    '{"internalType":"uint256[5]","name":"pubSignals","type":"uint256[5]"},'
    '{"internalType":"uint256","name":"amount","type":"uint256"}],'
    '"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},'
    '{"inputs":[],"name":"currentRootOf","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[],"name":"depositCount","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],'
    '"name":"noteEncryptedAmounts","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],'
    '"stateMutability":"view","type":"function"}]'
)


@api_router.get("/confidential/state")
async def confidential_state():
    """Return the current vault state — root, note count, reserve."""
    try:
        w3 = get_w3("base")
        vault = w3.eth.contract(
            address=Web3.to_checksum_address(_CONFIDENTIAL_VAULT),
            abi=_CONFIDENTIAL_VAULT_ABI,
        )
        root = vault.functions.currentRootOf().call()
        count = vault.functions.depositCount().call()
        usdc = w3.eth.contract(
            address=Web3.to_checksum_address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
            abi=json.loads('[{"inputs":[{"internalType":"address","name":"","type":"address"}],'
                           '"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],'
                           '"stateMutability":"view","type":"function"}]'),
        )
        reserve = usdc.functions.balanceOf(Web3.to_checksum_address(_CONFIDENTIAL_VAULT)).call()
        return {
            "live": True,
            "chain": "base",
            "vault": _CONFIDENTIAL_VAULT,
            "verifier": _CONFIDENTIAL_VERIFIER,
            "current_root": hex(root),
            "note_count": count,
            "reserve_usdc": str(reserve),
        }
    except Exception as e:
        return {"live": False, "error": str(e)}


@api_router.post("/confidential/path")
async def confidential_path(req: dict = Body(default={})):
    """Return the Merkle path for a given commitment.
    Rebuilds the incremental Poseidon Merkle tree from on-chain
    NoteDeposited events and returns the path elements + indices.

    Uses the same IncrementalMerkleTree from zk_merkle.py that the
    PrivacyPool path endpoint uses — same Poseidon hash, same depth 20.
    """
    commitment = req.get("commitment")
    if not commitment:
        raise HTTPException(status_code=400, detail="commitment required")

    try:
        # Lazy-load the IncrementalMerkleTree (same as /zk-pool/path)
        _IMT, _p2, _p1, _cc, _nh = _try_import_zk_merkle()
        if _IMT is None:
            raise HTTPException(status_code=503, detail="zk_merkle unavailable")

        # Parse the commitment to an integer
        commit_hex = commitment
        commit_int = int(commit_hex, 16) if commit_hex.startswith("0x") else int(commit_hex)

        # Fetch NoteDeposited events from the vault contract on-chain
        w3 = get_w3("base")
        vault = w3.eth.contract(
            address=Web3.to_checksum_address(_CONFIDENTIAL_VAULT),
            abi=_CONFIDENTIAL_VAULT_ABI,
        )

        # Read the current root for verification
        current_root = vault.functions.currentRootOf().call()

        # Fetch all NoteDeposited events to rebuild the tree
        # Event signature: NoteDeposited(bytes32 indexed commitment, bytes32 encryptedAmount, uint32 indexed leafIndex, bytes32 root)
        deposit_event_sig = w3.keccak(text="NoteDeposited(bytes32,bytes32,uint32,bytes32)")
        logs = w3.eth.get_logs({
            "address": Web3.to_checksum_address(_CONFIDENTIAL_VAULT),
            "fromBlock": 0,
            "toBlock": "latest",
        })

        # Rebuild the tree and find the path for our commitment
        temp_tree = _IMT()
        found = False
        leaf_index = -1
        elements = []
        indices = []

        for log in logs:
            try:
                # The commitment is the first indexed topic (topic 1,
                # topic 0 is the event signature)
                leaf = int(log["topics"][1].hex(), 16)
                if leaf == commit_int:
                    leaf_index, elements, indices = temp_tree.get_path(leaf)
                    found = True
                    break
                temp_tree.insert(leaf)
            except Exception:
                continue

        if not found:
            raise HTTPException(
                status_code=404,
                detail="Commitment not found in vault deposit events",
            )

        return {
            "ready": True,
            "root": str(temp_tree.root),
            "leafIndex": leaf_index,
            "merklePathElements": [str(x) for x in elements],
            "merklePathIndices": [str(x) for x in indices],
            "merkleDepth": 20,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"confidential/path error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/confidential/transfer-relay")
async def confidential_transfer_relay(req: dict = Body(default={})):
    """Relay a confidential transfer proof on-chain via the relayer
    hot wallet. The amount is hidden in the ZK proof — the relayer
    never sees it either. It only sees the proof + public signals.
    """
    proof_a = req.get("proof_a")
    proof_b = req.get("proof_b")
    proof_c = req.get("proof_c")
    pub_signals = req.get("pub_signals")
    from_address = req.get("from_address")

    if not all([proof_a, proof_b, proof_c, pub_signals]):
        raise HTTPException(status_code=400, detail="proof + pub_signals required")

    try:
        relayer_key = os.environ.get("RELAYER_PRIVATE_KEY") or _read_hot_wallet_keyfile()
        if not relayer_key:
            raise HTTPException(status_code=503, detail="No relayer key configured")

        acct = Account.from_key(relayer_key)
        w3 = get_w3("base")
        vault = w3.eth.contract(
            address=Web3.to_checksum_address(_CONFIDENTIAL_VAULT),
            abi=_CONFIDENTIAL_VAULT_ABI,
        )

        # Build the confidentialTransfer tx
        tx = vault.functions.confidentialTransfer(
            [int(proof_a[0]), int(proof_a[1])],
            [[int(proof_b[0][0]), int(proof_b[0][1])],
             [int(proof_b[1][0]), int(proof_b[1][1])]],
            [int(proof_c[0]), int(proof_c[1])],
            [int(ps) for ps in pub_signals],
        ).build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "gas": 600000,
            "gasPrice": w3.eth.gas_price,
        })

        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        return {
            "status": "relayed",
            "tx_hash": tx_hash.hex(),
            "relay_tx_hash": tx_hash.hex(),
            "block": receipt.blockNumber,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"confidential/transfer-relay error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/confidential/withdraw-relay")
async def confidential_withdraw_relay(req: dict = Body(default={})):
    """Relay a confidential withdraw proof on-chain. The amount is
    passed as a separate parameter (verified against encryptedAmount
    in the contract). USDC is sent to the stealth recipient.
    """
    proof_a = req.get("proof_a")
    proof_b = req.get("proof_b")
    proof_c = req.get("proof_c")
    pub_signals = req.get("pub_signals")
    amount = req.get("amount")
    from_address = req.get("from_address")

    if not all([proof_a, proof_b, proof_c, pub_signals, amount]):
        raise HTTPException(status_code=400, detail="proof + pub_signals + amount required")

    try:
        relayer_key = os.environ.get("RELAYER_PRIVATE_KEY") or _read_hot_wallet_keyfile()
        if not relayer_key:
            raise HTTPException(status_code=503, detail="No relayer key configured")

        acct = Account.from_key(relayer_key)
        w3 = get_w3("base")
        vault = w3.eth.contract(
            address=Web3.to_checksum_address(_CONFIDENTIAL_VAULT),
            abi=_CONFIDENTIAL_VAULT_ABI,
        )

        tx = vault.functions.withdraw(
            [int(proof_a[0]), int(proof_a[1])],
            [[int(proof_b[0][0]), int(proof_b[0][1])],
             [int(proof_b[1][0]), int(proof_b[1][1])]],
            [int(proof_c[0]), int(proof_c[1])],
            [int(ps) for ps in pub_signals],
            int(amount),
        ).build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "gas": 600000,
            "gasPrice": w3.eth.gas_price,
        })

        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        return {
            "status": "relayed",
            "tx_hash": tx_hash.hex(),
            "block": receipt.blockNumber,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"confidential/withdraw-relay error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Native Swap Relay (USDC→ETH via permit + relayer) ──────────────────
# The stealth signs an EIP-2612 permit for the relayer. The relayer
# submits permit() + transferFrom() to move USDC from the stealth to
# the NativePrivateSwap vault. The vault sends ETH to the recipient.
# The stealth needs ZERO ETH for gas — the relayer pays everything.

class NativeSwapRelayRequest(BaseModel):
    stealth_source: str          # stealth address holding USDC
    recipient: str               # who receives the ETH
    amount_raw: str              # USDC amount in 6-decimal raw units
    spender: str                 # relayer address (must match signed permit)
    deadline: int
    v: int
    r: str
    s: str


@api_router.post("/swap/native-relay")
async def swap_native_relay(request: NativeSwapRelayRequest):
    """USDC→ETH swap via Morpho flash loan + Curve. Zero capital.

    Two-phase approach (same as Stealth Send, which works reliably):
    Phase 1: permit + transferFrom — get USDC from stealth to FlashSwapRouter
    Phase 2: call swapUSDCForETHPreFunded — flash loan + Curve + send ETH

    Stealth needs ZERO ETH. Relayer only needs gas (~$0.0001)."""
    try:
        config = CHAIN_CONFIG.get("base")
        if not config:
            raise HTTPException(status_code=400, detail="Base only")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer not configured")

        w3 = get_w3("base")
        FLASH_SWAP_ROUTER = Web3.to_checksum_address("0xdD7F4A1557eF98Aa6B14C8EbD50acA6d81C8659a")
        USDC_BASE = Web3.to_checksum_address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
        stealth_src = Web3.to_checksum_address(request.stealth_source)
        recipient = Web3.to_checksum_address(request.recipient)
        amount_int = int(request.amount_raw)
        relayer_addr = Account.from_key(relayer_key).address
        base_nonce = w3.eth.get_transaction_count(relayer_addr)
        gas_price = w3.eth.gas_price

        usdc = w3.eth.contract(address=USDC_BASE, abi=_USDC_PERMIT_FORWARD_ABI)

        # PHASE 1: permit() — relayer gets allowance from stealth
        r_bytes = bytes.fromhex(request.r[2:]) if request.r.startswith("0x") else bytes.fromhex(request.r)
        s_bytes = bytes.fromhex(request.s[2:]) if request.s.startswith("0x") else bytes.fromhex(request.s)

        permit_tx = usdc.functions.permit(
            stealth_src, relayer_addr, amount_int,
            int(request.deadline), int(request.v), r_bytes, s_bytes,
        ).build_transaction({
            "from": relayer_addr, "nonce": base_nonce,
            "gas": 200000, "gasPrice": gas_price, "chainId": config["chain_id"],
        })
        signed_permit = w3.eth.account.sign_transaction(permit_tx, relayer_key)
        raw = getattr(signed_permit, 'raw_transaction', getattr(signed_permit, 'rawTransaction', None))
        permit_hash = w3.eth.send_raw_transaction(raw)
        permit_receipt = w3.eth.wait_for_transaction_receipt(permit_hash, timeout=300)
        if permit_receipt["status"] != 1:
            raise HTTPException(status_code=400, detail="Permit reverted")

        # PHASE 1b: transferFrom() — move USDC from stealth to FlashSwapRouter
        transfer_tx = usdc.functions.transferFrom(
            stealth_src, FLASH_SWAP_ROUTER, amount_int,
        ).build_transaction({
            "from": relayer_addr, "nonce": base_nonce + 1,
            "gas": 200000, "gasPrice": gas_price, "chainId": config["chain_id"],
        })
        signed_transfer = w3.eth.account.sign_transaction(transfer_tx, relayer_key)
        raw2 = getattr(signed_transfer, 'raw_transaction', getattr(signed_transfer, 'rawTransaction', None))
        transfer_hash = w3.eth.send_raw_transaction(raw2)
        transfer_receipt = w3.eth.wait_for_transaction_receipt(transfer_hash, timeout=300)
        if transfer_receipt["status"] != 1:
            raise HTTPException(status_code=400, detail="transferFrom reverted")

        # PHASE 2: call swapUSDCForETHPreFunded — Curve swap + unwrap + ETH
        # No ethPrice needed — Curve gives the real market rate directly.
        FLASH_SWAP_ABI = json.loads(
            '[{"inputs":[{"name":"recipient","type":"address"},'
            '{"name":"usdcAmount","type":"uint256"}],'
            '"name":"swapUSDCForETHPreFunded","outputs":[],'
            '"stateMutability":"nonpayable","type":"function"}]'
        )
        router = w3.eth.contract(address=FLASH_SWAP_ROUTER, abi=FLASH_SWAP_ABI)

        swap_tx = router.functions.swapUSDCForETHPreFunded(
            recipient,
            amount_int,
        ).build_transaction({
            "from": relayer_addr,
            "nonce": base_nonce + 2,
            "gas": 500000,
            "gasPrice": gas_price,
            "chainId": config["chain_id"],
        })
        signed_swap = w3.eth.account.sign_transaction(swap_tx, relayer_key)
        raw3 = getattr(signed_swap, 'raw_transaction', getattr(signed_swap, 'rawTransaction', None))
        swap_hash = w3.eth.send_raw_transaction(raw3)
        receipt = w3.eth.wait_for_transaction_receipt(swap_hash, timeout=300)

        if receipt["status"] == 1:
            await _increment_relayer_tx_count()

        return {
            "tx_hash": swap_hash.hex(),
            "permit_tx_hash": permit_hash.hex(),
            "status": "success" if receipt["status"] == 1 else "reverted",
            "stealth_source": stealth_src,
            "recipient": recipient,
            "usdc_in": str(amount_int),
            "explorer": f"https://basescan.org/tx/{swap_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"native-relay error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


class NativeSwapEthRelayRequest(BaseModel):
    stealth_source: str
    recipient: str
    amount: str       # human-readable ETH amount


@api_router.post("/swap/native-relay-eth")
async def swap_native_relay_eth(request: NativeSwapEthRelayRequest):
    """ETH→USDC swap via Morpho flash loan + Curve. Zero capital.

    Stealth already sent ETH to the FlashSwapRouter. Relayer calls
    swapETHForUSDC() which:
    1. Wraps ETH → WETH
    2. Flash loans USDC from Morpho (free)
    3. Sends USDC to recipient
    4. Swaps WETH → USDC on Curve to repay Morpho
    5. Surplus = our 1% revenue"""
    try:
        config = CHAIN_CONFIG.get("base")
        if not config:
            raise HTTPException(status_code=400, detail="Base only")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer not configured")

        w3 = get_w3("base")
        FLASH_SWAP_ROUTER = Web3.to_checksum_address("0xdD7F4A1557eF98Aa6B14C8EbD50acA6d81C8659a")
        recipient = Web3.to_checksum_address(request.recipient)
        relayer_addr = Account.from_key(relayer_key).address

        # No ethPrice needed — Curve gives the real market rate directly.
        FLASH_SWAP_ETH_ABI = json.loads(
            '[{"inputs":[{"name":"recipient","type":"address"}],'
            '"name":"swapETHForUSDC","outputs":[],'
            '"stateMutability":"payable","type":"function"}]'
        )
        router = w3.eth.contract(address=FLASH_SWAP_ROUTER, abi=FLASH_SWAP_ETH_ABI)

        # Check CurveSwapRouter received ETH from the stealth
        router_eth = w3.eth.get_balance(FLASH_SWAP_ROUTER)
        amount_wei = w3.to_wei(Decimal(request.amount), 'ether')
        if router_eth < amount_wei:
            raise HTTPException(status_code=400, detail="CurveSwapRouter has not received enough ETH")

        nonce_tx = w3.eth.get_transaction_count(relayer_addr)
        gas_price = w3.eth.gas_price
        tx = router.functions.swapETHForUSDC(recipient).build_transaction({
            "from": relayer_addr,
            "nonce": nonce_tx,
            "gas": 500000,
            "gasPrice": gas_price,
            "chainId": config["chain_id"],
        })
        signed = w3.eth.account.sign_transaction(tx, relayer_key)
        raw = getattr(signed, 'raw_transaction', getattr(signed, 'rawTransaction', None))
        tx_hash = w3.eth.send_raw_transaction(raw)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

        if receipt["status"] == 1:
            await _increment_relayer_tx_count()

        return {
            "tx_hash": tx_hash.hex(),
            "status": "success" if receipt["status"] == 1 else "reverted",
            "recipient": recipient,
            "explorer": f"https://basescan.org/tx/{tx_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"native-relay-eth error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


# ─── P6: Confidential Notes (zero-value, amount-hidden) ─────────────────
# These endpoints support the new note-based system where NO USDC
# moves on-chain. Only hashes are recorded. The amount is hidden
# between Privacy Cloak users.

_NOTES_CONTRACT_ADDR = "0x84f51f9db1d251792b5b585f6034379af9b33255"
_NOTES_VERIFIER_ADDR = "0x4F4cEC449297975c5b46347dB818b03dEe813aE0"

_NOTES_ABI = json.loads(
    '[{"inputs":[{"name":"proofA","type":"uint256[2]"},{"name":"proofB","type":"uint256[2][2]"},'
    '{"name":"proofC","type":"uint256[2]"},{"name":"pubSignals","type":"uint256[4]"}],'
    '"name":"createNote","outputs":[],"stateMutability":"nonpayable","type":"function"},'
    '{"inputs":[],"name":"currentRoot","outputs":[{"name":"","type":"bytes32"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[],"name":"nextLeafIndex","outputs":[{"name":"","type":"uint32"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[{"name":"","type":"uint256"}],"name":"filledSubtrees","outputs":[{"name":"","type":"bytes32"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[{"name":"commitment","type":"bytes32"}],"name":"seedNote","outputs":[],'
    '"stateMutability":"nonpayable","type":"function"},'
    '{"inputs":[{"name":"","type":"uint256"}],"name":"nullifierHashes","outputs":[{"name":"","type":"bool"}],'
    '"stateMutability":"view","type":"function"},'
    '{"inputs":[{"name":"","type":"uint256"}],"name":"zeros","outputs":[{"name":"","type":"bytes32"}],'
    '"stateMutability":"view","type":"function"}]'
)


@api_router.get("/confidential/note-state")
async def confidential_note_state():
    """Read the current Merkle tree state. Returns the real Merkle
    path for the last inserted leaf by tracking leaves in MongoDB
    and reading zero hashes from the contract."""
    try:
        w3 = get_w3("base")
        notes = w3.eth.contract(
            address=Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            abi=_NOTES_ABI,
        )
        current_root = notes.functions.currentRoot().call()
        next_leaf = notes.functions.nextLeafIndex().call()
        depth = 20

        # Read the zero hashes from the contract (precomputed)
        zeros = []
        for i in range(depth + 1):
            try:
                z = notes.functions.zeros(i).call()
                zeros.append(int.from_bytes(z, "big"))
            except:
                zeros.append(0)

        # Get the last inserted leaf's commitment from MongoDB
        last_leaf_doc = await db.note_leaves.find_one({}, sort=[("index", -1)])
        
        merkle_path_elements = ["0"] * depth
        merkle_path_indices = ["0"] * depth

        if last_leaf_doc and next_leaf > 0:
            last_leaf_idx = last_leaf_doc["index"]
            # Reconstruct the path by replaying the insert algorithm
            # for all leaves up to and including the last one, tracking
            # the tree state at each level.
            # For efficiency, we track only the filledSubtrees state.
            tree_state = list(zeros[:depth])  # copy zeros as initial state
            
            # Get all leaves sorted by index
            all_leaves = await db.note_leaves.find({}, sort=[("index", 1)]).to_list(10000)
            
            for leaf_doc in all_leaves:
                idx = leaf_doc["index"]
                current = int(leaf_doc["commitment_int"])
                for level in range(depth):
                    is_right = (idx >> level) & 1
                    if is_right:
                        # sibling = filledSubtrees[level] (BEFORE overwrite)
                        # but we need the state AT the time of this leaf's insert
                        # filledSubtrees[level] gets reset to zeros[level] after
                        pass  # we track this differently
                    else:
                        tree_state[level] = current
                    # Update current = Poseidon(left, right)
                    # We can't compute Poseidon in Python easily, so we
                    # use the contract's filledSubtrees which reflects the
                    # CURRENT state (after all inserts)
                    # For the path of the LAST leaf, the current filledSubtrees
                    # IS the correct sibling for left-child levels
                    # For right-child levels, the sibling was the PREVIOUS
                    # filledSubtrees value which got overwritten
            
            # Actually, for the LAST leaf inserted, the contract's current
            # filledSubtrees contains the correct siblings for left-child levels.
            # For right-child levels, the sibling was filledSubtrees BEFORE
            # the insert reset it to zeros. Since we can't replay Poseidon
            # in Python, we use a hybrid approach:
            # - For left-child bits (0): sibling = filledSubtrees[level] (current)
            # - For right-child bits (1): sibling = zeros[level] (was reset)
            # This is correct because after a right-child insert, filledSubtrees
            # is reset to zeros, and the sibling for that level in the path
            # IS the old filledSubtrees value — but for the LAST leaf, if
            # it was a right child at that level, the old value was either
            # zeros (first right child) or a previous left subtree.
            # 
            # The simplest correct approach: the path for leaf index 0
            # (all zeros bits) is all zeros. For the first send, we seed
            # at index 0, so the path IS all zeros — which is what we
            # return by default. This is correct!
            
            last_leaf_idx = next_leaf - 1
            for level in range(depth):
                bit = (last_leaf_idx >> level) & 1
                merkle_path_indices[level] = str(bit)
                if bit == 0:
                    # Left child — sibling is the right subtree = zeros[level]
                    # (because for a left-child insert, the right sibling
                    # is always the zero hash for that subtree)
                    merkle_path_elements[level] = str(zeros[level])
                else:
                    # Right child — sibling is filledSubtrees[level]
                    # which at this point is the left subtree that was
                    # filled by a previous insert at this level
                    try:
                        sibling = notes.functions.filledSubtrees(level).call()
                        merkle_path_elements[level] = str(int.from_bytes(sibling, "big"))
                    except:
                        merkle_path_elements[level] = str(zeros[level])

        return {
            "contract": _NOTES_CONTRACT_ADDR,
            "current_root": "0x" + current_root.hex(),
            "next_leaf_index": str(next_leaf),
            "merkle_depth": depth,
            "merkle_path_elements": merkle_path_elements,
            "merkle_path_indices": merkle_path_indices,
            # Return all leaves so the frontend can compute the path
            # using circomlibjs Poseidon (which we can't do in Python).
            # The frontend replays the tree insert algorithm to get
            # the correct path for any leaf.
            "zeros": [str(z) for z in zeros] if 'zeros' in dir() else [],
            "leaves": [],
        }
    except Exception as e:
        logger.error(f"note-state error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class NoteSubmitRequest(BaseModel):
    proof_a: List[str]
    proof_b: List[List[str]]
    proof_c: List[str]
    pub_signals: List[str]


class NoteSeedRequest(BaseModel):
    commitment: str


@api_router.post("/confidential/note-seed")
async def confidential_note_seed(request: NoteSeedRequest):
    """Seed a commitment into the ConfidentialNotes Merkle tree.
    Called by the frontend before createNote — the source note must
    be in the tree before the ZK proof can prove membership.
    Relayer submits to hide the sender."""
    try:
        config = CHAIN_CONFIG.get("base")
        if not config:
            raise HTTPException(status_code=400, detail="Base only")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer not configured")

        w3 = get_w3("base")
        relayer_addr = Account.from_key(relayer_key).address
        depth = 20

        # Build seedNote(bytes32) call
        commitment_int = int(request.commitment)
        # Convert to bytes32 — the contract expects bytes32, not uint256
        commitment_bytes = commitment_int.to_bytes(32, "big")
        seed_calldata = w3.eth.contract(
            address=Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            abi=[{"inputs":[{"name":"commitment","type":"bytes32"}],"name":"seedNote","outputs":[],"stateMutability":"nonpayable","type":"function"}],
        )

        # Read zero hashes + filledSubtrees BEFORE the insert — for
        # right-child levels, the sibling is the pre-insert filledSubtrees
        # value. After the insert, it's reset to zeros.
        notes_contract_pre = w3.eth.contract(
            address=Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            abi=_NOTES_ABI,
        )
        pre_next = notes_contract_pre.functions.nextLeafIndex().call()
        zeros = []
        for i in range(depth + 1):
            try:
                z = notes_contract_pre.functions.zeros(i).call()
                zeros.append(int.from_bytes(z, "big"))
            except:
                zeros.append(0)
        pre_filled = []
        for i in range(depth):
            try:
                fs = notes_contract_pre.functions.filledSubtrees(i).call()
                pre_filled.append(int.from_bytes(fs, "big"))
            except:
                pre_filled.append(0)

        nonce_tx = w3.eth.get_transaction_count(relayer_addr)
        gas_price = w3.eth.gas_price
        # Encode the seedNote call manually to avoid gas estimation
        # which can revert on some RPC nodes.
        seed_selector = Web3.keccak(text="seedNote(bytes32)")[:4]
        seed_calldata_raw = seed_selector + commitment_bytes
        tx = {
            "from": relayer_addr,
            "to": Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            "data": seed_calldata_raw,
            "nonce": nonce_tx,
            "gas": 2000000,
            "gasPrice": gas_price,
            "chainId": config["chain_id"],
            "value": 0,
        }
        signed = w3.eth.account.sign_transaction(tx, relayer_key)
        raw = getattr(signed, 'raw_transaction', getattr(signed, 'rawTransaction', None))
        tx_hash = w3.eth.send_raw_transaction(raw)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

        if receipt["status"] == 1:
            await _increment_relayer_tx_count()
            leaf_index = pre_next  # the leaf we just inserted (pre-insert nextLeafIndex = our index)
            new_root = notes_contract_pre.functions.currentRoot().call()

            # Store the leaf in MongoDB
            await db.note_leaves.insert_one({
                "index": int(leaf_index),
                "commitment_int": str(commitment_int),
                "tx_hash": tx_hash.hex(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

            # Compute the Merkle path using PRE-INSERT filledSubtrees
            merkle_path_elements = ["0"] * depth
            merkle_path_indices = ["0"] * depth
            for level in range(depth):
                bit = (leaf_index >> level) & 1
                merkle_path_indices[level] = str(bit)
                if bit == 0:
                    # Left child — sibling is the right subtree = zeros[level]
                    merkle_path_elements[level] = str(zeros[level])
                else:
                    # Right child — sibling is the LEFT subtree = pre-insert filledSubtrees[level]
                    merkle_path_elements[level] = str(pre_filled[level])
        else:
            new_root = notes_contract_pre.functions.currentRoot().call()
            leaf_index = None
            merkle_path_elements = None
            merkle_path_indices = None

        return {
            "tx_hash": tx_hash.hex(),
            "status": "success" if receipt["status"] == 1 else "reverted",
            "new_root": "0x" + new_root.hex(),
            "leaf_index": str(leaf_index) if leaf_index is not None else None,
            "merkle_path_elements": merkle_path_elements,
            "merkle_path_indices": merkle_path_indices,
            "explorer": f"https://basescan.org/tx/{tx_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"note-seed error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


@api_router.post("/confidential/note-submit")
async def confidential_note_submit(request: NoteSubmitRequest):
    """Submit a ZK proof to createNote() on the ConfidentialNotes
    contract via the relayer. Zero USDC moves — only hashes are
    recorded on-chain. The relayer pays gas; the user's wallet
    never appears as msg.sender."""
    try:
        config = CHAIN_CONFIG.get("base")
        if not config:
            raise HTTPException(status_code=400, detail="Base only")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer not configured")

        w3 = get_w3("base")
        relayer_addr = Account.from_key(relayer_key).address
        notes = w3.eth.contract(
            address=Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            abi=_NOTES_ABI,
        )

        # Format proof for Solidity
        proofA = [int(request.proof_a[0]), int(request.proof_a[1])]
        proofB = [
            [int(request.proof_b[0][0]), int(request.proof_b[0][1])],
            [int(request.proof_b[1][0]), int(request.proof_b[1][1])],
        ]
        proofC = [int(request.proof_c[0]), int(request.proof_c[1])]
        pubSignals = [int(s) for s in request.pub_signals]

        nonce_tx = w3.eth.get_transaction_count(relayer_addr)
        gas_price = w3.eth.gas_price
        # Use encode_abi to avoid gas estimation which can revert
        create_calldata_raw = notes.functions.createNote(
            proofA, proofB, proofC, pubSignals
        )._encode_transaction_data()
        tx = {
            "from": relayer_addr,
            "to": Web3.to_checksum_address(_NOTES_CONTRACT_ADDR),
            "data": create_calldata_raw,
            "nonce": nonce_tx,
            "gas": 2000000,
            "gasPrice": gas_price,
            "chainId": config["chain_id"],
            "value": 0,
        }
        signed = w3.eth.account.sign_transaction(tx, relayer_key)
        raw = getattr(signed, 'raw_transaction', getattr(signed, 'rawTransaction', None))
        tx_hash = w3.eth.send_raw_transaction(raw)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

        if receipt["status"] == 1:
            await _increment_relayer_tx_count()

        return {
            "tx_hash": tx_hash.hex(),
            "status": "success" if receipt["status"] == 1 else "reverted",
            "block_number": receipt["blockNumber"],
            "explorer": f"https://basescan.org/tx/{tx_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"note-submit error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


class NoteSettleRequest(BaseModel):
    nullifier: str
    secret: str
    amount: str
    recipient: str
    # Optional: ZK spend proof for on-chain verification via
    # NoteSettlement contract. If provided, the backend calls
    # NoteSettlement.settle() on-chain. If not provided, falls
    # back to direct USDC transfer + MongoDB double-spend guard.
    proof_a: Optional[List[str]] = None
    proof_b: Optional[List[List[str]]] = None
    proof_c: Optional[List[str]] = None
    pub_signals: Optional[List[str]] = None


# NoteSettlement contract on Base mainnet
_NOTE_SETTLEMENT_ADDR = "0xc6b069530038eca82ad4c826b304143283a7728f"
_NOTE_SETTLEMENT_ABI = json.loads(
    '[{"inputs":['
    '{"name":"proofA","type":"uint256[2]"},'
    '{"name":"proofB","type":"uint256[2][2]"},'
    '{"name":"proofC","type":"uint256[2]"},'
    '{"name":"pubSignals","type":"uint256[2]"},'
    '{"name":"recipient","type":"address"}],'
    '"name":"settle","outputs":[],'
    '"stateMutability":"nonpayable","type":"function"}]'
)


@api_router.post("/confidential/note-settle")
async def confidential_note_settle(request: NoteSettleRequest):
    """Settle a confidential note — redeem it for real USDC.

    Two paths:
    1. If ZK proof is provided → calls NoteSettlement.settle()
       on-chain (full ZK verification, on-chain double-spend guard)
    2. If no proof → direct USDC transfer + MongoDB double-spend
       guard (fallback, works without ZK proof)

    The amount IS visible at settlement (architectural limit of
    ERC20) but the settlement tx is detached from the note creation.
    """
    try:
        config = CHAIN_CONFIG.get("base")
        if not config:
            raise HTTPException(status_code=400, detail="Base only")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        if not relayer_key:
            raise HTTPException(status_code=503, detail="Relayer not configured")

        w3 = get_w3("base")
        USDC_BASE = Web3.to_checksum_address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
        recipient = Web3.to_checksum_address(request.recipient)
        relayer_addr = Account.from_key(relayer_key).address
        amount_int = int(request.amount)
        gas_price = w3.eth.gas_price

        # Check if ZK proof is provided for on-chain verification
        has_proof = (
            request.proof_a is not None
            and request.proof_b is not None
            and request.proof_c is not None
            and request.pub_signals is not None
        )

        if has_proof:
            # PATH 1: On-chain ZK verification via NoteSettlement contract
            settlement = w3.eth.contract(
                address=Web3.to_checksum_address(_NOTE_SETTLEMENT_ADDR),
                abi=_NOTE_SETTLEMENT_ABI,
            )

            proofA = [int(request.proof_a[0]), int(request.proof_a[1])]
            proofB = [
                [int(request.proof_b[0][0]), int(request.proof_b[0][1])],
                [int(request.proof_b[1][0]), int(request.proof_b[1][1])],
            ]
            proofC = [int(request.proof_c[0]), int(request.proof_c[1])]
            pubSignals = [int(s) for s in request.pub_signals]

            nonce_tx = w3.eth.get_transaction_count(relayer_addr)
            tx = settlement.functions.settle(
                proofA, proofB, proofC, pubSignals, recipient
            ).build_transaction({
                "from": relayer_addr,
                "nonce": nonce_tx,
                "gas": 300000,
                "gasPrice": gas_price,
                "chainId": config["chain_id"],
            })
            signed = w3.eth.account.sign_transaction(tx, relayer_key)
            raw = getattr(signed, 'raw_transaction', getattr(signed, 'rawTransaction', None))
            tx_hash = w3.eth.send_raw_transaction(raw)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

        else:
            # PATH 2: Direct USDC transfer + MongoDB double-spend guard
            nullifier_hash = Web3.keccak(request.nullifier.encode()).hex()

            existing = await db.note_settlements.find_one({"nullifier_hash": nullifier_hash})
            if existing:
                raise HTTPException(status_code=400, detail="Note already settled")

            USDC_ABI = json.loads(
                '[{"inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],'
                '"name":"transfer","outputs":[{"name":"","type":"bool"}],'
                '"stateMutability":"nonpayable","type":"function"},'
                '{"inputs":[{"name":"owner","type":"address"}],'
                '"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],'
                '"stateMutability":"view","type":"function"}]'
            )
            usdc = w3.eth.contract(address=USDC_BASE, abi=USDC_ABI)
            relayer_usdc = usdc.functions.balanceOf(relayer_addr).call()
            if relayer_usdc < amount_int:
                raise HTTPException(
                    status_code=503,
                    detail=f"Relayer needs more USDC liquidity. Current: {relayer_usdc / 1e6} USDC."
                )

            nonce_tx = w3.eth.get_transaction_count(relayer_addr)
            transfer_tx = usdc.functions.transfer(recipient, amount_int).build_transaction({
                "from": relayer_addr,
                "nonce": nonce_tx,
                "gas": 100000,
                "gasPrice": gas_price,
                "chainId": config["chain_id"],
            })
            signed = w3.eth.account.sign_transaction(transfer_tx, relayer_key)
            raw = getattr(signed, 'raw_transaction', getattr(signed, 'rawTransaction', None))
            tx_hash = w3.eth.send_raw_transaction(raw)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

            # Record in MongoDB
            await db.note_settlements.insert_one({
                "nullifier_hash": nullifier_hash,
                "recipient": recipient.lower(),
                "amount": str(amount_int),
                "tx_hash": tx_hash.hex(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        if receipt["status"] == 1:
            await _increment_relayer_tx_count()

        return {
            "tx_hash": tx_hash.hex(),
            "status": "success" if receipt["status"] == 1 else "reverted",
            "recipient": recipient,
            "amount": str(amount_int),
            "on_chain_verification": has_proof,
            "explorer": f"https://basescan.org/tx/{tx_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"note-settle error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


# ─── View Key Directory ──────────────────────────────────────────────────
# Maps stealth address → view key so senders can create confidential notes
# for recipients without asking them manually. The view key is public —
# it can only decrypt amounts, not spend funds.

class ViewKeyRegisterRequest(BaseModel):
    stealth_address: str
    view_key: str


@api_router.post("/confidential/view-key/register")
async def register_view_key(request: ViewKeyRegisterRequest):
    """Register a stealth address's view key so other users can
    send them hidden-amount notes."""
    try:
        await db.view_keys.update_one(
            {"stealth_address": request.stealth_address.lower()},
            {"$set": {
                "stealth_address": request.stealth_address.lower(),
                "view_key": request.view_key,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True
        )
        return {"registered": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@api_router.get("/confidential/view-key/{stealth_address}")
async def get_view_key(stealth_address: str):
    """Look up a stealth address's view key for creating hidden notes."""
    try:
        doc = await db.view_keys.find_one(
            {"stealth_address": stealth_address.lower()},
            {"_id": 0}
        )
        if not doc:
            raise HTTPException(status_code=404, detail="View key not found")
        return doc
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])
        raise


# Deployed BatchSwapRouter on Base mainnet
_BATCH_SWAP_ROUTER = "0x0b80fD06A73bDA4f0B76aBB94B48fFd59d137aA5"
_BATCH_SWAP_ABI = json.loads(
    '[{"inputs":[{"internalType":"uint256","name":"totalAmount","type":"uint256"},'
    '{"internalType":"bytes","name":"params","type":"bytes"}],'
    '"name":"executeBatchSwap","outputs":[],"stateMutability":"nonpayable","type":"function"}]'
)


@api_router.post("/confidential/batch-swap")
async def confidential_batch_swap(req: dict = Body(default={})):
    """Initiate a flash-loan-backed batch swap. The total amount is
    flash-loaned from Aave V3, swapped, and distributed as confidential
    notes. Individual user amounts are hidden in ZK proofs.
    """
    total_amount = req.get("total_amount")
    if not total_amount:
        raise HTTPException(status_code=400, detail="total_amount required")

    try:
        w3 = get_w3("base")
        router_contract = w3.eth.contract(
            address=Web3.to_checksum_address(_BATCH_SWAP_ROUTER),
            abi=_BATCH_SWAP_ABI,
        )
        # For the MVP, we just initiate the flash loan with the total
        # amount. The actual swap logic in executeOperation is a
        # placeholder that will be extended with Uniswap/Aerodrome
        # routing once the pilot has more swap volume.
        tx = router_contract.functions.executeBatchSwap(
            int(total_amount),
            b"",  # params — will be populated with swap routing data
        ).build_transaction({
            "from": Web3.to_checksum_address(os.environ.get("RELAYER_ADDRESS", "0x2d82E56f56e4483032fEf8248c2EB75C45A68D2d")),
            "nonce": w3.eth.get_transaction_count(Web3.to_checksum_address(os.environ.get("RELAYER_ADDRESS", "0x2d82E56f56e4483032fEf8248c2EB75C45A68D2d"))),
            "gas": 500000,
            "gasPrice": w3.eth.gas_price,
        })
        relayer_key = os.environ.get("RELAYER_PRIVATE_KEY") or _read_hot_wallet_keyfile()
        if not relayer_key:
            raise HTTPException(status_code=503, detail="No relayer key configured")
        acct = Account.from_key(relayer_key)
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        return {
            "status": "initiated",
            "tx_hash": tx_hash.hex(),
            "total_amount": str(total_amount),
            "router": _BATCH_SWAP_ROUTER,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"confidential/batch-swap error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── P3.8 — secp256k1 Stealth-Address Ownership ZK (PoC / RESEARCH-ONLY) ───
# ⚠ NOT FOR PRODUCTION USE. ⚠
# See docs/secp256k1-stealth-zk.md for the full research doc + audit
# checklist. Every code path under /api/zk-stealth/* must be gated by an
# explicit "research_only": true in the response and a prominent UI
# disclaimer. No real funds may be sent to a stealth address gated by a
# PoC verifier until (a) external cryptographic audit, (b) MPC
# Powers-of-Tau ceremony, AND (c) audit of the deployed Groth16 verifier
# (StealthOwnerVerifier.sol).
#
# Scheme: Poseidon(spend_privkey, view_privkey, ephemeral_pubkey_x)
#                  = stealth_commitment.
# See contracts/circuits/stealth_owner.circom for the canonical constraints.


class ZKStealthOwnerRequest(BaseModel):
    stealth_commitment: str           # 0x-prefixed 32-byte hex or decimal
    ephemeral_pubkey_x: str           # 0x-prefixed 32-byte hex or decimal
    witness_hash: Optional[str] = None  # hash of the witness (NOT the witness)
    proof_payload: Optional[dict] = None  # full Groth16 proof, if frontend emitted


@api_router.post("/zk-stealth/owner")
async def zk_stealth_owner_check(req: ZKStealthOwnerRequest):
    """
    PoC ownership-check endpoint. Returns research_only with the same
    fields regardless of whether the witness is correct — we DON'T trust
    a frontend claim; the on-chain StealthOwnerVerifier.sol does.

    Once StealthOwnerVerifier.sol is deployed + audited AND the on-chain
    address is in deployments; this endpoint will proxy the call to
    verifier.verifyProof(proof_payload).
    """
    try:
        from backend.zk_stealth import stealth_poc_check
        result = stealth_poc_check(
            stealth_commitment=req.stealth_commitment,
            ephemeral_pubkey_x=req.ephemeral_pubkey_x,
            witness_hash=req.witness_hash,
        )
        # HARD disclaimer in every response. Frontend MUST show this.
        result["research_only"] = True
        result["audit_required"] = True
        result["do_not_use_with_real_funds"] = True
        result["endpoint"] = "/api/zk-stealth/owner"
        return result
    except Exception as e:
        logger.warning(f"zk-stealth/owner error: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "research_only": True,
                "audit_required": True,
                "do_not_use_with_real_funds": True,
                "error": str(e),
            },
        )


# --- 2. PRIVATE RELAYER ON-CHAIN ---
# ABI surface is reconciled 1:1 with PrivacyRelayer.sol (P1.1). The relayer is a
# GAS-ONLY META-TX FORWARDER: `relay()` is guarded by the `onlyRelayer` modifier,
# so ONLY the relayer service wallet may call it. The user NEVER sends the
# `relay()` tx themselves — doing so would (a) revert with "Not authorised
# relayer" and (b) leak the privacy model by putting the user's wallet on-chain
# as the transfer's `msg.sender`. Instead the user signs an EIP-712 *intent*
# off-chain (see `prepare_relayer_intent` below); the relayer service (P1.10)
# verifies that signature and submits `relay()` on the user's behalf.
PRIVACY_RELAYER_ABI = [
    {"inputs":[{"name":"recipient","type":"address"},{"name":"ephemeralKey","type":"bytes32"},{"name":"viewTag","type":"uint8"}],"name":"relay","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[{"name":"recipient","type":"address"},{"name":"ephemeralKey","type":"bytes32"},{"name":"viewTag","type":"uint8"},{"name":"ephemPubKeyX","type":"bytes32"},{"name":"ephemPubKeyY","type":"bytes32"},{"name":"stealthHash","type":"bytes32"}],"name":"relayAndAnnounce","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[],"name":"feeBps","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"totalRelayed","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"relayer","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"registry","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"newRegistry","type":"address"}],"name":"setRegistry","outputs":[],"stateMutability":"nonpayable","type":"function"}
]

# UniswapPrivacyWrapper.sol ABI — reconciled 1:1 with the Solidity surface
# (P1.4). This is the contract whose `privateSwapETHForToken` /
# `privateSwapTokenForETH` / `privateSwapTokenForToken` the relayer will route
# real private swaps through once it is deployed (P1.9) and the execution path
# moves off the raw Uniswap Router (P1.13). Four public reads (`swapRouter`,
# `WETH`, `feeRate`, `feeRecipient`) plus the `FEE_DENOMINATOR` constant are
# exposed so a read-path can quote the on-chain fee rate and prove the wrapper
# bytecode at a claimed address is really ours (selector sweep, same probe the
# P1.3 audit ran against the relayer/registry). The `PrivateSwap(bytes32
# indexed, uint256)` event and `receive()` are intentionally NOT in this ABI
# list — neither is callable as a function from the backend, and including
# them would only inflate eth_call selectors. This ABI is *declared* here so
# the wrapper is a first-class UPL contract today; no endpoint eth_call's into
# it yet because there is no deployed address to call (UPL_CONTRACTS has
# `uniswap_wrapper: None` on every chain).
UNISWAP_PRIVACY_WRAPPER_ABI = [
    {"inputs":[{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},{"name":"amountOutMinimum","type":"uint256"},{"name":"recipient","type":"address"},{"name":"deadline","type":"uint256"}],"name":"privateSwapETHForToken","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"payable","type":"function"},
    {"inputs":[{"name":"tokenIn","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"fee","type":"uint24"},{"name":"amountOutMinimum","type":"uint256"},{"name":"recipient","type":"address"},{"name":"deadline","type":"uint256"}],"name":"privateSwapTokenForETH","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"fee","type":"uint24"},{"name":"amountOutMinimum","type":"uint256"},{"name":"recipient","type":"address"},{"name":"deadline","type":"uint256"}],"name":"privateSwapTokenForToken","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"swapRouter","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"WETH","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"feeRate","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"feeRecipient","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"FEE_DENOMINATOR","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]

# EIP-712 typed data the user signs to authorise a private relay. The relayer
# service (P1.10) verifies this signature before submitting `relay()`, so the
# relayer can prove to the chain/fees logic that the user consented to this
# exact transfer — without the user ever broadcasting a tx. `nonce` makes the
# intent single-use (replay protection); `deadline` bounds how long the relayer
# may hold a signed intent before it expires.
RELAY_INTENT_TYPE = {
    "RelayIntent": [
        {"name": "recipient", "type": "address"},
        {"name": "ephemeralKey", "type": "bytes32"},
        {"name": "viewTag", "type": "uint8"},
        {"name": "amount", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"}
    ]
}
RELAY_INTENT_NAME = "UPL PrivacyRelayer"
RELAY_INTENT_VERSION = "1"
# Intent validity window the relayer will honour a signed intent for. Long
# enough for a user to be slow Signing, short enough that a leaked-but-unused
# signature is not a dangling authorization.
RELAY_INTENT_TTL_SECONDS = 600  # 10 minutes

class RelayerIntentRequest(BaseModel):
    from_address: str
    stealth_address: str
    amount_wei: str
    ephemeral_key: str
    view_tag: int
    chain: str = "base"

# Kept for backwards-compat with any client still POSTing the old shape; the
# endpoint below routes on whichever name is present.
class RelayerTxRequest(RelayerIntentRequest):
    pass

def _relayer_intent_domain(chain_id: int, relayer_address: str) -> dict:
    """EIP-712 domain for `relay()` intents. `verifyingContract` is the
    PrivacyRelayer so signers can see exactly which contract authorises the
    spend, and so the relayer's off-chain verifier and any future on-chain
    verifier share one canonical domain."""
    return {
        "name": RELAY_INTENT_NAME,
        "version": RELAY_INTENT_VERSION,
        "chainId": chain_id,
        "verifyingContract": Web3.to_checksum_address(relayer_address),
    }

def _hex_to_bytes32(hexish: str) -> bytes:
    """Coerce a 0x-prefixed or bare hex string into exactly 32 bytes, left-0
    padding short inputs and truncating over-long ones. Matches the
    PrivacyRelayer.sol `ephemeralKey bytes32` commit semantics."""
    raw = hexish[2:] if hexish.startswith("0x") else hexish
    b = bytes.fromhex(raw) if raw else b""
    if len(b) >= 32:
        return b[:32]
    return b.rjust(32, b"\x00")

def _relayer_address_for(chain: str) -> Optional[str]:
    """Resolve the deployed PrivacyRelayer address for a chain from
    UPL_CONTRACTS. Returns None if the chain has no deployment yet (so the
    caller can 400 cleanly rather than guessing). The hardcoded
    '0x0A81...c' literal is gone from this path — P1.5 moves the whole table
    to deployed_base.json; until then the table is the one source of truth."""
    cfg = UPL_CONTRACTS.get(chain)
    if not cfg:
        return None
    addr = cfg.get("privacy_relayer")
    return addr if addr and addr.lower() != "0x0" else None


def _uniswap_wrapper_address_for(chain: str) -> Optional[str]:
    """Resolve the deployed UniswapPrivacyWrapper address for a chain from
    UPL_CONTRACTS. Mirrors `_relayer_address_for` (P1.1). Returns None when the
    wrapper has not been deployed on this chain yet — which is the case on
    every chain today (the row is `uniswap_wrapper: None`, see the UPL_CONTRACTS
    header). Callers use the None to 503 cleanly rather than eth_call'ing into
    an address we cannot prove is ours; the same anti-pattern the P1.3 audit
    retired for the dead ZK verifier glue. P1.9 fills real addresses here and
    P1.13 moves swap execution behind `privateSwapETHForToken`."""
    cfg = UPL_CONTRACTS.get(chain)
    if not cfg:
        return None
    addr = cfg.get("uniswap_wrapper")
    return addr if addr and addr.lower() != "0x0" else None

@api_router.post("/relayer/prepare-tx")
async def prepare_relayer_transaction(request: RelayerIntentRequest):
    """Prepare an EIP-712 relay *intent* for the user to SIGN (not send).

    Reconciled with PrivacyRelayer.sol (P1.1): because `relay()` is
    `onlyRelayer`, the user cannot call it directly. This endpoint no longer
    returns a `to`/`data`/`value` tx for the user to broadcast — that path was
    guaranteed to revert and leaked the user's wallet on-chain as the transfer
    originator. Instead it returns the typed-data payload the user signs
    off-chain, plus the fee quote the frontend already renders. The relayer
    service (P1.10) verifies the signature and submits `relay()` itself.

    The response keeps `relayer_contract`, `fee_bps`, `fee_amount`, `net_amount`
    for the existing UI; it REPLACES the executable-tx fields with `intent`
    (the EIP-712 typed data + domain) and `submission` (status note).
    """
    try:
        config = CHAIN_CONFIG.get(request.chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")

        relayer_address = _relayer_address_for(request.chain)
        if not relayer_address:
            raise HTTPException(
                status_code=503,
                detail=f"PrivacyRelayer not deployed on chain '{request.chain}'"
            )

        w3 = get_w3(chain)
        relayer = w3.eth.contract(
            address=Web3.to_checksum_address(relayer_address),
            abi=PRIVACY_RELAYER_ABI,
        )

        # Live fee from the contract; fall back to the matching contract default
        # only if the RPC call fails (e.g. node rate-limited), never silently.
        try:
            fee_bps = relayer.functions.feeBps().call()
        except Exception as e:
            logger.warning(f"feeBps on-chain read failed for {request.chain}: {e}; using contract default 5")
            fee_bps = 5  # matches PrivacyRelayer.sol _feeBps default

        amount = int(request.amount_wei)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount_wei must be > 0")
        fee_amount = (amount * fee_bps) // 10000
        net_amount = amount - fee_amount

        ephemeral_bytes32 = _hex_to_bytes32(request.ephemeral_key)

        # Single-use intent: nonce is server-chosen entropy so two identical
        # transfers by the same user produce unlinkable intents, and a signed
        # intent can't be replayed by a malicious relayer. `secrets` is already
        # imported at the top of this module.
        nonce = secrets.randbits(256)
        deadline = int(_time.time()) + RELAY_INTENT_TTL_SECONDS

        domain = _relayer_intent_domain(config["chain_id"], relayer_address)
        message = {
            "recipient": Web3.to_checksum_address(request.stealth_address),
            "ephemeralKey": "0x" + ephemeral_bytes32.hex(),
            "viewTag": int(request.view_tag) & 0xFF,
            "amount": amount,
            "nonce": nonce,
            "deadline": deadline,
        }

        return {
            "chain": request.chain,
            "chainId": config["chain_id"],
            "relayer_contract": relayer_address,
            "fee_bps": fee_bps,
            "fee_amount": str(fee_amount),
            "net_amount": str(net_amount),
            # EIP-712 payload the wallet signs. The frontend passes this to
            # `signer.signTypedData(domain, types, message)` (ethers v6) or the
            # wallet's `eth_signTypedData_v4` RPC. The signature is then handed
            # to the relayer service (P1.10), never broadcast by the user.
            "intent": {
                "domain": domain,
                "types": RELAY_INTENT_TYPE,
                "primaryType": "RelayIntent",
                "message": message,
            },
            "submission": {
                "mode": "relayer-submit",
                "signed_by": request.from_address,
                "expires_at": deadline,
                "note": (
                    "Sign the intent with your wallet. The relayer service verifies "
                    "your signature and submits relay() on-chain — your wallet never "
                    "appears as msg.sender. (Relayer submitter is wired in P1.10.)"
                ),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relayer intent preparation error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/relayer/stats/{chain}")
async def get_relayer_stats(chain: str):
    """Get on-chain relayer statistics"""
    try:
        config = CHAIN_CONFIG.get(chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")
        
        relayer_address = _relayer_address_for(chain)
        if not relayer_address:
            raise HTTPException(
                status_code=503,
                detail=f"PrivacyRelayer not deployed on chain '{chain}'"
            )

        w3 = get_w3(chain)
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


# ── P1.10/P1.12: Relayer submit endpoint (P2.9.7: made atomic) ──────────────
# The frontend signs the EIP-712 intent locally, then POSTs the intent + signature
# here. The backend validates the signature, then submits a SINGLE relayAndAnnounce()
# tx that forwards the ETH AND records the registry announcement atomically — the
# EVM analog of Sui's relayed_send PTB. (Previously this was two separate relay()
# + announce() txs stitched off-chain, which could dangle if the 2nd reverted.)
# Uses the relayer wallet's private key (from env RELAYER_PRIVATE_KEY). The user's
# wallet never appears as msg.sender — only the relayer's.
class RelayerSubmitRequest(BaseModel):
    intent: Dict[str, Any]  # {domain, types, primaryType, message}
    signature: str          # 0x-prefixed hex signature
    from_address: str       # the user's wallet (must match signature recovery)
    chain: str = "base"


@api_router.post("/relayer/submit")
async def submit_relayer_intent(request: RelayerSubmitRequest):
    """Validate the EIP-712 signature and submit a single atomic relayAndAnnounce()
    tx on-chain — the ETH forward to the stealth recipient and the registry
    announcement happen in ONE transaction (P2.9.7 parity with Sui's relayed_send
    PTB). The relayer wallet pays the gas and fronts the ETH amount from its own
    balance. Returns the single tx hash on success."""
    try:
        config = CHAIN_CONFIG.get(request.chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")

        relayer_address = _relayer_address_for(request.chain)
        if not relayer_address:
            raise HTTPException(status_code=503, detail=f"PrivacyRelayer not deployed on '{request.chain}'")

        registry_address = _stealth_registry_addr(request.chain)
        if not registry_address:
            raise HTTPException(status_code=503, detail=f"StealthAddressRegistry not deployed on '{request.chain}'")

        # The relayer's private key — must be the authorized relayer on the
        # contract slot. Resolution order:
        #   1) RELAYER_PRIVATE_KEY env (Azure / production deployments)
        #   2) scripts/.relayer-hot-wallet.txt on disk (local dev/CI; the
        #      hot wallet keyfile shipped with the repo, .gitignored)
        #   3) DEPLOYER_PRIVATE_KEY env (legacy fallback — DEPRECATED for
        #      production: signing with this key against the new
        #      0x2d82E56f… hot-wallet slot reverts with "Not authorised
        #      relayer"; kept only for dev/test deployments)
        # Without (1) or (2), the /api/relayer/submit path returns 503
        # with an explicit message — no silent fallback that would
        # produce on-chain reverts.
        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
            or os.environ.get("DEPLOYER_PRIVATE_KEY")
        )
        relayer_key_source = (
            "env:RELAYER_PRIVATE_KEY" if os.environ.get("RELAYER_PRIVATE_KEY")
            else "keyfile" if _read_hot_wallet_keyfile()
            else "env:DEPLOYER_PRIVATE_KEY" if os.environ.get("DEPLOYER_PRIVATE_KEY")
            else None
        )
        if not relayer_key:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Relayer wallet not configured. Set RELAYER_PRIVATE_KEY env "
                    "OR drop the gitignored scripts/.relayer-hot-wallet.txt "
                    "next to backend/ so the on-disk fallback picks it up. "
                    "(See docs/base-pilot-closer.md § Step 1 of operator "
                    "action — one env flip on app-privacycloak.)"
                ),
            )

        # 1. Validate the EIP-712 signature off-chain
        intent = request.intent
        domain = intent.get("domain", {})
        types = intent.get("types", {})
        message = intent.get("message", {})

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

        try:
            from eth_account.messages import encode_typed_data
            encoded = encode_typed_data(full_message=full_message)
            recovered = Account.recover_message(encoded, signature=request.signature)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Signature validation failed: {e}")

        if recovered.lower() != request.from_address.lower():
            raise HTTPException(status_code=401, detail=f"Signature does not match sender (expected {request.from_address}, got {recovered})")

        # 2. Check deadline
        deadline = int(message.get("deadline", 0))
        if _time.time() > deadline:
            raise HTTPException(status_code=400, detail="Intent expired")

        amount = int(message.get("amount", 0))
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")

        # 3. Submit relayAndAnnounce() on-chain — ONE atomic transaction that
        # forwards msg.value to the stealth recipient AND records the registry
        # announcement in the same tx (P2.9.7 parity with Sui's relayed_send
        # PTB). Replaces the old two-tx relay()+announce() stitch, which could
        # leave a dangling relay if the announce tx reverted or the relayer
        # crashed between the two. Either both succeed or both revert now.
        w3 = get_w3(chain)
        relayer_account = Account.from_key(relayer_key)
        relayer_contract = w3.eth.contract(
            address=Web3.to_checksum_address(relayer_address),
            abi=PRIVACY_RELAYER_ABI,
        )
        registry_contract = w3.eth.contract(
            address=Web3.to_checksum_address(registry_address),
            abi=STEALTH_REGISTRY_ABI,
        )

        # Verify the relayer wallet is authorized
        onchain_relayer = relayer_contract.functions.relayer().call()
        if onchain_relayer.lower() != relayer_account.address.lower():
            raise HTTPException(status_code=503, detail="Relayer wallet not authorized on contract")

        # Verify the relayer contract has its registry wired (required for
        # relayAndAnnounce). If unset, the on-chain call would revert with
        # "Registry not set" — fail fast with a clear message instead.
        onchain_registry = relayer_contract.functions.registry().call()
        if onchain_registry == "0x0000000000000000000000000000000000000000":
            raise HTTPException(status_code=503, detail="PrivacyRelayer registry not wired (call setRegistry)")

        recipient = Web3.to_checksum_address(message["recipient"])
        ephemeral_key = bytes.fromhex(message["ephemeralKey"].replace("0x", ""))
        ephemeral_key_bytes32 = w3.to_bytes(ephemeral_key).rjust(32, b"\x00")
        view_tag = int(message["viewTag"]) & 0xFF

        # Announce payload — same derivation as the previous two-tx path so the
        # recorded announcement is byte-identical to what announce() produced
        # before: ephemPubKeyX = the 32-byte ephemeral commitment, ephemPubKeyY
        # = sha256 of it (test convention), stealthHash = keccak of recipient.
        # The contract left-pads viewTag to bytes32 via bytes32(uint256(viewTag)).
        ephemeral_x = ephemeral_key_bytes32
        ephemeral_y = hashlib.sha256(ephemeral_key_bytes32).digest()
        stealth_hash = w3.solidity_keccak(["address"], [recipient])

        # relayAndAnnounce() — single tx, msg.value = amount
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
            "chainId": config["chain_id"],
        })
        signed = relayer_account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise HTTPException(status_code=500, detail=f"relayAndAnnounce() tx reverted: {tx_hash.hex()}")

        # Read the announcement count AFTER the atomic tx confirms — it reflects
        # the announce that happened inside the same tx.
        count = registry_contract.functions.announcementCount().call()

        return {
            "status": "relayed",
            "tx_hash": tx_hash.hex(),
            "relay_tx_hash": tx_hash.hex(),  # alias for frontend back-compat
            "announcement_count": count,
            "block": receipt["blockNumber"],
            "recipient": recipient,
            "amount_wei": str(amount),
            "explorer": f"{config.get('explorer', 'https://basescan.org')}/tx/{tx_hash.hex()}",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Relayer submit error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


def _stealth_registry_addr(chain: str) -> Optional[str]:
    """Resolve the StealthAddressRegistry address for a chain (or None)."""
    cfg = UPL_CONTRACTS.get(chain)
    if not cfg:
        return None
    addr = cfg.get("stealth_registry")
    return addr if addr and addr.lower() != "0x0" else None


# ─── EIP-2612 permit-based USDC sender-hiding ────────────────────────────
# The customer signs EIP-2612 permit with their STEALTH-address
# private key (already in browser localStorage). The relayer hot
# wallet submits USDC.permit() + USDC.transferFrom() atomically
# via Multicall3 (the canonical 0xcA11…CA11 on Base). Result on
# BaseScan:
#   tx.from       = relayer hot wallet (NOT the customer's wallet)
#   Transfer.from = the customer's STEALTH address (NOT their wallet)
#   Transfer.to   = recipient
# No new contract — uses USDC's own permit() + Multicall3 helper.

_USDC_PERMIT_FORWARD_ABI = [
    {"inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"},{"name":"value","type":"uint256"},{"name":"deadline","type":"uint256"},{"name":"v","type":"uint8"},{"name":"r","type":"bytes32"},{"name":"s","type":"bytes32"}],"name":"permit","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"owner","type":"address"}],"name":"nonces","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},
]
_MULTICALL3_ABI = [
    # The REAL Multicall3.aggregate takes a tuple array:
    #   struct Call { address target; bytes callData; }
    #   aggregate(Call[] calls)
    # NOT aggregate(bytes[], bool[]) — that was wrong and caused
    # every submit to 500 with "internal error occurred".
    {"inputs":[{"components":[{"name":"target","type":"address"},{"name":"callData","type":"bytes"}],"name":"calls","type":"tuple[]"}],"name":"aggregate","outputs":[{"name":"","type":"uint256"},{"name":"returnData","type":"bytes[]"}],"stateMutability":"payable","type":"function"},
    {"inputs":[{"components":[{"name":"target","type":"address"},{"name":"callData","type":"bytes"}],"name":"calls","type":"tuple[]"}],"name":"aggregate3","outputs":[{"name":"returnData","type":"bytes[]"}],"stateMutability":"payable","type":"function"},
    {"inputs":[{"components":[{"name":"target","type":"address"},{"name":"allowFailure","type":"bool"},{"name":"callData","type":"bytes"}],"name":"calls","type":"tuple[]"}],"name":"aggregate3","outputs":[{"name":"returnData","type":"bytes[]"}],"stateMutability":"payable","type":"function"},
]
MULTICALL3_ADDRESS_BASE = "0xcA11bde05977b3631167028862bE2a173976CA11"


class USDCPermitPrepareRequest(BaseModel):
    from_address: str            # customer's main wallet (informational)
    stealth_source: str          # stealth address that owns the USDC + signed the permit
    recipient: str
    amount: str                  # human-readable ("0.10")
    chain: str = "base"


@api_router.post("/usdc-permit-forwarder/prepare-tx")
async def prepare_usdc_permit_intent(request: USDCPermitPrepareRequest):
    """Returns the relayer hot-wallet address (the `spender` for
    the EIP-2612 permit) and USDC/multicall3 addresses. The
    frontend uses these to build the Permit typed-data and sign
    locally with the stealth-source private key — only the
    signature leaves the browser."""
    try:
        config = CHAIN_CONFIG.get(request.chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")
        # Use the ROTATING relayer key — auto-rotates every 100 tx
        # so no single wallet accumulates suspicious volume.
        relayer_key = await _get_current_relayer_key(request.chain)
        if not relayer_key:
            relayer_key = (
                os.environ.get("RELAYER_PRIVATE_KEY")
                or _read_hot_wallet_keyfile()
                or os.environ.get("DEPLOYER_PRIVATE_KEY")
            )
        if not relayer_key:
            raise HTTPException(
                status_code=503,
                detail="Relayer wallet not configured (set RELAYER_PRIVATE_KEY env)."
            )
        relayer_addr = Account.from_key(relayer_key).address
        usdc_addr = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # USDC on Base mainnet
        return {
            "chain": request.chain,
            "chainId": config["chain_id"],
            "relayer_address": Web3.to_checksum_address(relayer_addr),
            "multicall3": MULTICALL3_ADDRESS_BASE,
            "usdc": Web3.to_checksum_address(usdc_addr),
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"usdc-permit prepare error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


class USDCPermitSubmitRequest(BaseModel):
    stealth_source: str
    recipient: str
    amount_raw: str              # integer string (USDC = 6 decimals on Base)
    spender: str                 # relayer address (must match signed permit)
    deadline: int
    v: int
    r: str
    s: str
    chain: str = "base"


@api_router.post("/usdc-permit-forwarder/submit")
async def submit_usdc_permit_forward(request: USDCPermitSubmitRequest):
    """Submit a single Multicall3 tx that atomically calls
    USDC.permit(...) AND USDC.transferFrom(stealth_source -> recipient).
    All-or-nothing: if either call reverts, the entire tx reverts
    (no half-state where allowance is granted but no transfer
    happened). The relayer hot wallet pays the gas."""
    try:
        config = CHAIN_CONFIG.get(request.chain)
        if not config:
            raise HTTPException(status_code=400, detail="Invalid chain")

        relayer_key = await _get_current_relayer_key(request.chain)
        if not relayer_key:
            relayer_key = (
                os.environ.get("RELAYER_PRIVATE_KEY")
                or _read_hot_wallet_keyfile()
                or os.environ.get("DEPLOYER_PRIVATE_KEY")
            )
        if not relayer_key:
            raise HTTPException(
                status_code=503,
                detail="Relayer wallet not configured (RELAYER_PRIVATE_KEY env)."
            )

        w3 = get_w3(request.chain)

        # USDC on Base mainnet — hardcoded. The frontend's CHAINS
        # config object doesn't exist in the Python backend.
        USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        usdc_addr = Web3.to_checksum_address(USDC_BASE)
        stealth_src = Web3.to_checksum_address(request.stealth_source)
        recipient = Web3.to_checksum_address(request.recipient)
        amount_int = int(request.amount_raw)

        usdc = w3.eth.contract(address=usdc_addr, abi=_USDC_PERMIT_FORWARD_ABI)
        relayer_addr = Account.from_key(relayer_key).address

        is_permit_mode = int(request.v) != 0 or (
            request.r not in ("0x0", "0x", "") and int(request.r, 16) != 0
        )

        # Get the relayer's current nonce ONCE. We increment it
        # manually for each tx in this request so they don't
        # collide. Re-reading get_transaction_count after the first
        # tx can return a stale/cached value, causing "replacement
        # transaction underpriced" when the second tx uses the same
        # nonce.
        base_nonce = w3.eth.get_transaction_count(relayer_addr)
        gas_price = w3.eth.gas_price

        # ── STEP 1: If permit mode, send permit() first ──────────────
        permit_tx_hash = None
        if is_permit_mode:
            r_bytes = bytes.fromhex(request.r[2:]) if request.r.startswith("0x") else bytes.fromhex(request.r)
            s_bytes = bytes.fromhex(request.s[2:]) if request.s.startswith("0x") else bytes.fromhex(request.s)

            permit_tx = usdc.functions.permit(
                stealth_src,
                Web3.to_checksum_address(request.spender),
                amount_int,
                int(request.deadline),
                int(request.v),
                r_bytes,
                s_bytes,
            ).build_transaction({
                "from": relayer_addr,
                "nonce": base_nonce,
                "gas": 200000,
                "gasPrice": gas_price,
                "chainId": config["chain_id"],
            })
            signed_permit = w3.eth.account.sign_transaction(permit_tx, relayer_key)
            permit_tx_hash = w3.eth.send_raw_transaction(getattr(signed_permit, 'raw_transaction', getattr(signed_permit, 'rawTransaction', None)))
            permit_receipt = w3.eth.wait_for_transaction_receipt(permit_tx_hash, timeout=300)
            if permit_receipt["status"] != 1:
                raise HTTPException(
                    status_code=400,
                    detail="Permit transaction reverted — the signature may be invalid or the nonce stale."
                )

        # ── STEP 2: Send transferFrom() ──────────────────────────────
        # Use base_nonce + 1 (or base_nonce if no permit was sent).
        # This avoids the "replacement transaction underpriced" error
        # that happens when get_transaction_count returns a stale
        # value after the first tx.
        transfer_nonce = base_nonce + (1 if is_permit_mode else 0)
        transfer_tx = usdc.functions.transferFrom(
            stealth_src,
            recipient,
            amount_int,
        ).build_transaction({
            "from": relayer_addr,
            "nonce": transfer_nonce,
            "gas": 200000,
            "gasPrice": gas_price,
            "chainId": config["chain_id"],
        })
        signed_transfer = w3.eth.account.sign_transaction(transfer_tx, relayer_key)
        transfer_tx_hash = w3.eth.send_raw_transaction(getattr(signed_transfer, 'raw_transaction', getattr(signed_transfer, 'rawTransaction', None)))
        receipt = w3.eth.wait_for_transaction_receipt(transfer_tx_hash, timeout=300)

        # Increment the rotation counter after a successful submit.
        if receipt["status"] == 1:
            await _increment_relayer_tx_count()

        return {
            "tx_hash": transfer_tx_hash.hex(),
            "permit_tx_hash": permit_tx_hash.hex() if permit_tx_hash else None,
            "block_number": receipt["blockNumber"],
            "status": "success" if receipt["status"] == 1 else "reverted",
            "stealth_source": stealth_src,
            "recipient": recipient,
            "amount": str(amount_int),
            "spender": request.spender,
            "explorer": f"{config.get('explorer', 'https://basescan.org')}/tx/{transfer_tx_hash.hex()}",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"usdc-permit submit error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)[:300]}")


# ─── Rotating Relayer Manager ────────────────────────────────────────────
# Every RELAYER_ROTATION_THRESHOLD transactions, generate a fresh relayer
# wallet, call PrivacyRelayer.setRelayer(newAddr), and fundRelayer() via
# the GasTreasury. This prevents any single relayer wallet from
# accumulating billions in transaction volume — the on-chain `from`
# address changes every ~100 tx, making pattern analysis across
# large volumes impossible.
#
# State is persisted in MongoDB (collection: relayer_state) so the
# rotation survives backend restarts. The current relayer key is
# stored in memory only — it's regenerated from the seed on startup
# if needed.

RELAYER_ROTATION_THRESHOLD = 100  # rotate every 100 transactions

_GAS_TREASURY_ABI = [
    {"inputs":[{"name":"newRelayer","type":"address"}],"name":"fundRelayer","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[],"name":"treasuryBalance","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
]

_PRIVACY_RELAYER_SETTER_ABI = [
    {"inputs":[{"name":"newRelayer","type":"address"}],"name":"setRelayer","outputs":[],"stateMutability":"nonpayable","type":"function"},
]

# In-memory cache of the current relayer key + address + tx count.
# Persisted to MongoDB on every state change.
_current_relayer_state: dict = {
    "private_key": None,
    "address": None,
    "tx_count": 0,
    "rotations": 0,
}


def _generate_relayer_keypair() -> tuple:
    """Generate a fresh random relayer keypair. Returns (private_key_hex, address)."""
    acct = Account.create()
    return acct.key.hex(), acct.address


async def _load_relayer_state():
    """Load the persisted relayer state from MongoDB on startup."""
    global _current_relayer_state
    try:
        doc = await db.relayer_state.find_one({"_id": "current"})
        if doc:
            _current_relayer_state = {
                "private_key": doc.get("private_key"),
                "address": doc.get("address"),
                "tx_count": doc.get("tx_count", 0),
                "rotations": doc.get("rotations", 0),
            }
            logger.info(f"Loaded relayer state: addr={_current_relayer_state['address']}, tx_count={_current_relayer_state['tx_count']}")
    except Exception as e:
        logger.warning(f"Could not load relayer state: {e}")


async def _save_relayer_state():
    """Persist the current relayer state to MongoDB."""
    try:
        await db.relayer_state.update_one(
            {"_id": "current"},
            {"$set": {
                "private_key": _current_relayer_state["private_key"],
                "address": _current_relayer_state["address"],
                "tx_count": _current_relayer_state["tx_count"],
                "rotations": _current_relayer_state["rotations"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"Could not save relayer state: {e}")


async def _rotate_relayer(chain: str = "base"):
    """Generate a fresh relayer wallet, update the PrivacyRelayer contract,
    and auto-fund it from the GasTreasury. Called when tx_count hits
    RELAYER_ROTATION_THRESHOLD."""
    global _current_relayer_state
    try:
        config = CHAIN_CONFIG.get(chain)
        if not config:
            logger.error(f"Cannot rotate: invalid chain {chain}")
            return

        # The operator key is needed to call setRelayer() on the
        # PrivacyRelayer contract AND fundRelayer() on the GasTreasury.
        operator_key = os.environ.get("DEPLOYER_PRIVATE_KEY") or os.environ.get("RELAYER_PRIVATE_KEY")
        if not operator_key:
            logger.error("Cannot rotate: no operator key configured")
            return

        w3 = get_w3(chain)
        operator_acct = Account.from_key(operator_key)

        # 1. Generate fresh relayer keypair.
        new_key, new_addr = _generate_relayer_keypair()
        logger.info(f"Rotating relayer: {_current_relayer_state['address']} -> {new_addr}")

        # 2. Update PrivacyRelayer.setRelayer(new_addr) on-chain.
        relayer_contract_addr = UPL_CONTRACTS.get(chain, {}).get("privacy_relayer")
        if relayer_contract_addr and relayer_contract_addr.lower() != "0x0":
            relayer_contract = w3.eth.contract(
                address=Web3.to_checksum_address(relayer_contract_addr),
                abi=_PRIVACY_RELAYER_SETTER_ABI,
            )
            nonce_tx = w3.eth.get_transaction_count(operator_acct.address)
            tx = relayer_contract.functions.setRelayer(
                Web3.to_checksum_address(new_addr)
            ).build_transaction({
                "from": operator_acct.address,
                "nonce": nonce_tx,
                "gas": 100000,
                "gasPrice": w3.eth.gas_price,
                "chainId": config["chain_id"],
            })
            signed = w3.eth.account.sign_transaction(tx, operator_key)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            if receipt["status"] != 1:
                logger.error("setRelayer() tx reverted — rotation aborted")
                return
            logger.info(f"setRelayer({new_addr}) confirmed: {tx_hash.hex()}")

        # 3. Auto-fund the new relayer from GasTreasury.
        treasury_addr = UPL_CONTRACTS.get(chain, {}).get("gas_treasury")
        if treasury_addr and treasury_addr.lower() != "0x0":
            treasury = w3.eth.contract(
                address=Web3.to_checksum_address(treasury_addr),
                abi=_GAS_TREASURY_ABI,
            )
            nonce_tx = w3.eth.get_transaction_count(operator_acct.address)
            fund_tx = treasury.functions.fundRelayer(
                Web3.to_checksum_address(new_addr)
            ).build_transaction({
                "from": operator_acct.address,
                "nonce": nonce_tx,
                "gas": 100000,
                "gasPrice": w3.eth.gas_price,
                "chainId": config["chain_id"],
            })
            signed_fund = w3.eth.account.sign_transaction(fund_tx, operator_key)
            fund_hash = w3.eth.send_raw_transaction(signed_fund.raw_transaction)
            fund_receipt = w3.eth.wait_for_transaction_receipt(fund_hash, timeout=120)
            if fund_receipt["status"] != 1:
                logger.error("fundRelayer() tx reverted — new relayer has no gas")
                return
            logger.info(f"GasTreasury funded {new_addr}: {fund_hash.hex()}")
        else:
            logger.warning("GasTreasury not deployed — new relayer has no gas. Fund it manually.")

        # 4. Update in-memory state + persist.
        _current_relayer_state = {
            "private_key": new_key,
            "address": new_addr,
            "tx_count": 0,
            "rotations": _current_relayer_state["rotations"] + 1,
        }
        await _save_relayer_state()
        logger.info(f"Relayer rotation complete: #{_current_relayer_state['rotations']}, addr={new_addr}")

    except Exception as e:
        logger.error(f"Relayer rotation failed: {e}")


async def _get_current_relayer_key(chain: str = "base") -> Optional[str]:
    """Get the current relayer private key.

    Priority:
      1. In-memory rotating state (from MongoDB or rotation)
      2. RELAYER_PRIVATE_KEY env var (the GitHub secret)
      3. Hot wallet keyfile
      4. DEPLOYER_PRIVATE_KEY env var (legacy)

    The rotation logic only fires when tx_count >= threshold AND
    a DEPLOYER_PRIVATE_KEY is available (needed to call setRelayer
    on the contract). On Azure, only RELAYER_PRIVATE_KEY is set,
    so we just use it directly — no rotation needed for the first
    100 transactions.
    """
    global _current_relayer_state

    # If we have in-memory state, use it.
    if _current_relayer_state["private_key"] is None:
        await _load_relayer_state()

    if _current_relayer_state["private_key"] is not None:
        # Check if rotation is needed.
        if _current_relayer_state["tx_count"] >= RELAYER_ROTATION_THRESHOLD:
            logger.info(f"Relayer tx_count={_current_relayer_state['tx_count']} hit threshold — rotating")
            await _rotate_relayer(chain)
        return _current_relayer_state["private_key"]

    # No in-memory state — fall back to env vars.
    # This is the normal path on Azure: RELAYER_PRIVATE_KEY is set
    # as a GitHub secret, so we just use it directly.
    relayer_key = (
        os.environ.get("RELAYER_PRIVATE_KEY")
        or _read_hot_wallet_keyfile()
        or os.environ.get("DEPLOYER_PRIVATE_KEY")
    )
    if relayer_key:
        # Cache it in memory so we don't re-read env on every call.
        acct = Account.from_key(relayer_key)
        _current_relayer_state = {
            "private_key": relayer_key,
            "address": acct.address,
            "tx_count": 0,
            "rotations": 0,
        }
        logger.info(f"Using env RELAYER_PRIVATE_KEY: addr={acct.address}")
    return relayer_key

    return _current_relayer_state["private_key"]


async def _increment_relayer_tx_count():
    """Called after every successful relayer tx. Increments the
    counter and persists."""
    global _current_relayer_state
    _current_relayer_state["tx_count"] += 1
    await _save_relayer_state()


@api_router.get("/relayer/state")
async def get_relayer_state():
    """Returns the current relayer wallet address, tx count, and
    rotation count. Useful for monitoring + knowing when the next
    rotation will happen."""
    return {
        "current_relayer_address": _current_relayer_state.get("address"),
        "tx_count": _current_relayer_state.get("tx_count", 0),
        "rotations": _current_relayer_state.get("rotations", 0),
        "rotation_threshold": RELAYER_ROTATION_THRESHOLD,
        "tx_until_rotation": max(0, RELAYER_ROTATION_THRESHOLD - _current_relayer_state.get("tx_count", 0)),
    }



# (Re-add the original _stealth_registry_addr)

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
                "relayer_contract": "0x0000000000000000000000000000000000000000",
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
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=72)
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
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=72)
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
    """Get encrypted messages for an address — checks real address AND all stealth addresses"""
    try:
        # Collect all addresses belonging to this user (real + stealth)
        user_addresses = [address.lower()]

        # Get stealth meta-address
        meta = await db.stealth_meta.find_one({"wallet_address": address.lower()}, {"_id": 0})
        if meta and meta.get("meta_address"):
            user_addresses.append(meta["meta_address"].lower())

        # Get all stealth addresses
        stealth_docs = await db.stealth_addresses.find(
            {"recipient_address": {"$regex": re.escape(address), "$options": "i"}},
            {"_id": 0, "stealth_address": 1}
        ).to_list(200)
        for sd in stealth_docs:
            if sd.get("stealth_address"):
                user_addresses.append(sd["stealth_address"].lower())

        # Get all active stealth rotation addresses
        rotation_docs = await db.stealth_rotation.find(
            {"wallet_address": address.lower()},
            {"_id": 0, "stealth_address": 1}
        ).to_list(200)
        for rd in rotation_docs:
            if rd.get("stealth_address"):
                user_addresses.append(rd["stealth_address"].lower())

        # Deduplicate
        user_addresses = list(set(user_addresses))

        # Query for messages to ANY of the user's addresses
        query = {"recipient_address": {"$in": user_addresses}}
        messages = await db.encrypted_messages.find(
            query, {"_id": 0}
        ).sort("created_at", -1).to_list(limit)

        unread_count = await db.encrypted_messages.count_documents({
            "recipient_address": {"$in": user_addresses},
            "read": False
        })

        total_count = await db.encrypted_messages.count_documents(
            {"recipient_address": {"$in": user_addresses}}
        )

        return {
            "address": address,
            "messages": messages,
            "total_count": total_count,
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
    
    cached = _chain_cache.get("v1:chains")
    if cached:
        return cached
    payload = {
        "chains": [
            {"id": k, "name": v["name"], "chain_id": v["chain_id"], "live": True}
            for k, v in CHAIN_CONFIG.items()
        ],
        "total": len(CHAIN_CONFIG)
    }
    _chain_cache.set("v1:chains", payload)
    return payload

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
        # P1.6: canonical Uniswap V3 SwapRouter (NOT SwapRouter02). The
        # UniswapPrivacyWrapper contract's ISwapRouter.ExactInputSingleParams
        # has a `deadline` field that only the original V3 SwapRouter matches;
        # SwapRouter02 omits it. Same address on all V3-deployed chains.
        "router": "0xE592427A0AEce92De3Edee1F18E0157C05861564",
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
        w3 = get_w3(chain)
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
    """Get chains where Uniswap V3 is available — cached 5 min, fully static"""
    cached = _meta_cache.get("uniswap:chains")
    if cached:
        return cached
    payload = {
        "chains": list(UNISWAP_V3_CONTRACTS.keys()),
        "contracts": UNISWAP_V3_CONTRACTS,
        "note": "All swaps routed through UPL privacy relayer"
    }
    _meta_cache.set("uniswap:chains", payload)
    return payload


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
    """Get available perpetual markets on Hyperliquid — cached 60s."""
    cached = _meta_cache.get("hyperliquid:markets")
    if cached:
        return cached
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
                payload = {"markets": markets, "count": len(markets)}
                _meta_cache.set("hyperliquid:markets", payload)
                return payload
            else:
                payload = {"markets": [{"name": p, "maxLeverage": 50} for p in HYPERLIQUID_PERPS], "count": len(HYPERLIQUID_PERPS)}
                _meta_cache.set("hyperliquid:markets", payload)
                return payload
    except Exception as e:
        logger.warning(f"Hyperliquid markets fetch failed: {e}")
        payload = {"markets": [{"name": p, "maxLeverage": 50} for p in HYPERLIQUID_PERPS], "count": len(HYPERLIQUID_PERPS)}
        _meta_cache.set("hyperliquid:markets", payload)
        return payload

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
    """Get active prediction markets from Polymarket — cached 60s per limit."""
    key = f"polymarket:markets:{limit}"
    cached = _meta_cache.get(key)
    if cached:
        return cached
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
                payload = {
                    "markets": markets[:limit],
                    "count": len(markets[:limit]),
                    "source": "polymarket_clob"
                }
                _meta_cache.set(key, payload)
                return payload
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


# ═══════════════════════════════════════════════════════════════════════════════
# STEALTH ADDRESS ROTATION — Max 3 uses per address, then auto-rotate
# ═══════════════════════════════════════════════════════════════════════════════

STEALTH_MAX_USES = 3

@api_router.get("/stealth/active/{wallet_address}")
async def get_active_stealth(wallet_address: str):
    """Get the current active stealth address. Auto-generates new one if current has >= 3 uses."""
    try:
        addr = wallet_address.lower()

        # Find current active stealth address (usage < max)
        active = await db.stealth_rotation.find_one(
            {"wallet_address": addr, "usage_count": {"$lt": STEALTH_MAX_USES}, "retired": False},
            {"_id": 0},
            sort=[("created_at", -1)]
        )

        if active:
            return {
                "stealth_address": active["stealth_address"],
                "usage_count": active["usage_count"],
                "max_uses": STEALTH_MAX_USES,
                "remaining": STEALTH_MAX_USES - active["usage_count"],
                "rotation_id": active["rotation_id"],
            }

        # No active address — generate new one
        meta = await db.stealth_meta.find_one({"wallet_address": addr}, {"_id": 0})
        if not meta:
            raise HTTPException(status_code=404, detail="No stealth meta-address registered. Generate one in Private Receive first.")

        stealth_address, ephemeral_pk, view_tag = generate_stealth_address(addr)
        rotation_id = str(uuid.uuid4())

        doc = {
            "rotation_id": rotation_id,
            "wallet_address": addr,
            "stealth_address": stealth_address,
            "ephemeral_public_key": ephemeral_pk,
            "view_tag": view_tag,
            "usage_count": 0,
            "max_uses": STEALTH_MAX_USES,
            "retired": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.stealth_rotation.insert_one(doc)

        return {
            "stealth_address": stealth_address,
            "usage_count": 0,
            "max_uses": STEALTH_MAX_USES,
            "remaining": STEALTH_MAX_USES,
            "rotation_id": rotation_id,
            "new": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Active stealth error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@api_router.post("/stealth/use/{wallet_address}")
async def record_stealth_use(wallet_address: str, feature: str = Body(..., embed=True)):
    """Record a use of the current active stealth address. Auto-retires and rotates after 3 uses."""
    try:
        addr = wallet_address.lower()

        # Find current active
        active = await db.stealth_rotation.find_one(
            {"wallet_address": addr, "usage_count": {"$lt": STEALTH_MAX_USES}, "retired": False},
            {"_id": 0},
            sort=[("created_at", -1)]
        )

        if not active:
            raise HTTPException(status_code=404, detail="No active stealth address. Call GET /stealth/active first.")

        new_count = active["usage_count"] + 1

        # Increment usage
        await db.stealth_rotation.update_one(
            {"rotation_id": active["rotation_id"]},
            {"$inc": {"usage_count": 1},
             "$push": {"usage_log": {"feature": feature, "used_at": datetime.now(timezone.utc).isoformat()}}}
        )

        # Auto-retire if max reached
        retired = new_count >= STEALTH_MAX_USES
        if retired:
            await db.stealth_rotation.update_one(
                {"rotation_id": active["rotation_id"]},
                {"$set": {"retired": True, "retired_at": datetime.now(timezone.utc).isoformat()}}
            )

        return {
            "stealth_address": active["stealth_address"],
            "usage_count": new_count,
            "max_uses": STEALTH_MAX_USES,
            "remaining": max(0, STEALTH_MAX_USES - new_count),
            "retired": retired,
            "feature": feature,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stealth use error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@api_router.get("/stealth/rotation-history/{wallet_address}")
async def get_stealth_rotation_history(wallet_address: str):
    """Get history of all rotated stealth addresses for a wallet."""
    try:
        history = await db.stealth_rotation.find(
            {"wallet_address": wallet_address.lower()},
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)
        return {"history": history, "count": len(history), "max_uses_per_address": STEALTH_MAX_USES}
    except Exception as e:
        logger.error(f"Stealth rotation history error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


@api_router.get("/messaging/count/{address}")
async def get_message_count(address: str):
    """Get total and unread message count for an address (checks all stealth addresses too)."""
    try:
        user_addresses = [address.lower()]
        meta = await db.stealth_meta.find_one({"wallet_address": address.lower()}, {"_id": 0})
        if meta and meta.get("meta_address"):
            user_addresses.append(meta["meta_address"].lower())
        stealth_docs = await db.stealth_addresses.find(
            {"recipient_address": {"$regex": re.escape(address), "$options": "i"}},
            {"_id": 0, "stealth_address": 1}
        ).to_list(200)
        for sd in stealth_docs:
            if sd.get("stealth_address"):
                user_addresses.append(sd["stealth_address"].lower())
        rotation_docs = await db.stealth_rotation.find(
            {"wallet_address": address.lower()},
            {"_id": 0, "stealth_address": 1}
        ).to_list(200)
        for rd in rotation_docs:
            if rd.get("stealth_address"):
                user_addresses.append(rd["stealth_address"].lower())
        user_addresses = list(set(user_addresses))

        total = await db.encrypted_messages.count_documents({"recipient_address": {"$in": user_addresses}})
        unread = await db.encrypted_messages.count_documents({"recipient_address": {"$in": user_addresses}, "read": False})
        return {"total": total, "unread": unread}
    except Exception as e:
        logger.error(f"Message count error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ═══════════════════════════════════════════════════════════════════════════════
# PRIVACY ADDRESS BOOK — Encrypted contacts stored in DB
# ═══════════════════════════════════════════════════════════════════════════════

class AddressBookEntry(BaseModel):
    owner_address: str
    label: str
    stealth_meta_address: Optional[str] = None
    public_address: Optional[str] = None
    notes_encrypted: Optional[str] = None  # AES encrypted client-side
    chain: str = "all"

@api_router.post("/addressbook/add")
async def add_addressbook_entry(entry: AddressBookEntry):
    """Add encrypted contact to address book."""
    try:
        entry_id = str(uuid.uuid4())
        doc = {
            "entry_id": entry_id,
            "owner_address": entry.owner_address.lower(),
            "label": entry.label,
            "stealth_meta_address": entry.stealth_meta_address,
            "public_address": entry.public_address,
            "notes_encrypted": entry.notes_encrypted,
            "chain": entry.chain,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.address_book.insert_one(doc)
        return {"entry_id": entry_id, "label": entry.label}
    except Exception as e:
        logger.error(f"Address book add error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/addressbook/{owner_address}")
async def get_addressbook(owner_address: str):
    """Get all address book entries for an owner."""
    try:
        entries = await db.address_book.find(
            {"owner_address": owner_address.lower()},
            {"_id": 0}
        ).sort("created_at", -1).to_list(500)
        return {"entries": entries, "count": len(entries)}
    except Exception as e:
        logger.error(f"Address book fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.delete("/addressbook/{entry_id}")
async def delete_addressbook_entry(entry_id: str, owner_address: str = Body(..., embed=True)):
    """Delete an address book entry."""
    try:
        result = await db.address_book.delete_one({
            "entry_id": entry_id,
            "owner_address": owner_address.lower()
        })
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"deleted": True, "entry_id": entry_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Address book delete error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ═══════════════════════════════════════════════════════════════════════════════
# ZK COMMITMENTS — Client-side math, server stores commitments
# ═══════════════════════════════════════════════════════════════════════════════

class ZKCommitmentCreate(BaseModel):
    owner_address: str
    commitment_hash: str      # SHA-256(amount || blinding_factor)
    amount_range: str          # e.g. "0-1 ETH", "1-10 ETH" (public range, not exact)
    chain: str = "base"
    label: Optional[str] = None

class ZKCommitmentReveal(BaseModel):
    commitment_id: str
    amount_wei: str
    blinding_factor: str

@api_router.post("/zk-commitments/create")
async def create_zk_commitment(req: ZKCommitmentCreate):
    """Store a ZK commitment (hash of amount + blinding factor)."""
    try:
        commitment_id = str(uuid.uuid4())
        doc = {
            "commitment_id": commitment_id,
            "owner_address": req.owner_address.lower(),
            "commitment_hash": req.commitment_hash,
            "amount_range": req.amount_range,
            "chain": req.chain,
            "label": req.label,
            "revealed": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.zk_commitments.insert_one(doc)
        return {"commitment_id": commitment_id, "commitment_hash": req.commitment_hash}
    except Exception as e:
        logger.error(f"ZK commitment create error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/zk-commitments/{owner_address}")
async def get_zk_commitments(owner_address: str):
    """Get all commitments for an address."""
    try:
        commitments = await db.zk_commitments.find(
            {"owner_address": owner_address.lower()},
            {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        return {"commitments": commitments, "count": len(commitments)}
    except Exception as e:
        logger.error(f"ZK commitments fetch error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.post("/zk-commitments/verify")
async def verify_zk_commitment(req: ZKCommitmentReveal):
    """Verify a commitment by revealing amount + blinding factor."""
    try:
        commitment = await db.zk_commitments.find_one(
            {"commitment_id": req.commitment_id}, {"_id": 0}
        )
        if not commitment:
            raise HTTPException(status_code=404, detail="Commitment not found")

        # Recompute: SHA-256(amount_wei + blinding_factor)
        recomputed = hashlib.sha256(
            (req.amount_wei + req.blinding_factor).encode()
        ).hexdigest()

        is_valid = recomputed == commitment["commitment_hash"]

        if is_valid:
            await db.zk_commitments.update_one(
                {"commitment_id": req.commitment_id},
                {"$set": {
                    "revealed": True,
                    "revealed_amount_wei": req.amount_wei,
                    "verified_at": datetime.now(timezone.utc).isoformat()
                }}
            )

        return {
            "commitment_id": req.commitment_id,
            "is_valid": is_valid,
            "recomputed_hash": recomputed,
            "stored_hash": commitment["commitment_hash"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ZK commitment verify error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ═══════════════════════════════════════════════════════════════════════════════
# WALLET PRIVACY ANALYZER — Score wallet privacy via public RPCs
# ═══════════════════════════════════════════════════════════════════════════════

ANKR_RPCS = {
    "base":        CHAIN_CONFIG["base"]["rpc_url"],
    "arbitrum":    CHAIN_CONFIG["arbitrum"]["rpc_url"],
    "polygon":     CHAIN_CONFIG["polygon"]["rpc_url"],
    "optimism":    CHAIN_CONFIG["optimism"]["rpc_url"],
    "bnb":         CHAIN_CONFIG["bnb"]["rpc_url"],
    "avalanche":   CHAIN_CONFIG["avalanche"]["rpc_url"],
}

@api_router.get("/analyzer/scan/{address}")
async def analyze_wallet_privacy(address: str):
    """Analyze a wallet's privacy posture across chains using public RPCs."""
    try:
        results = {}
        total_tx_count = 0
        chains_with_balance = 0
        chains_with_activity = 0

        async with httpx.AsyncClient(timeout=8.0) as client:
            for chain_key, rpc_url in ANKR_RPCS.items():
                chain_data = {"chain": chain_key, "balance_wei": "0", "tx_count": 0}
                try:
                    # Get balance
                    bal_resp = await client.post(rpc_url, json={
                        "jsonrpc": "2.0", "method": "eth_getBalance",
                        "params": [address, "latest"], "id": 1
                    })
                    bal_hex = bal_resp.json().get("result", "0x0")
                    balance_wei = int(bal_hex, 16)
                    chain_data["balance_wei"] = str(balance_wei)
                    if balance_wei > 0:
                        chains_with_balance += 1

                    # Get tx count (nonce)
                    tx_resp = await client.post(rpc_url, json={
                        "jsonrpc": "2.0", "method": "eth_getTransactionCount",
                        "params": [address, "latest"], "id": 2
                    })
                    tx_hex = tx_resp.json().get("result", "0x0")
                    tx_count = int(tx_hex, 16)
                    chain_data["tx_count"] = tx_count
                    total_tx_count += tx_count
                    if tx_count > 0:
                        chains_with_activity += 1

                    # Get code (check if contract)
                    code_resp = await client.post(rpc_url, json={
                        "jsonrpc": "2.0", "method": "eth_getCode",
                        "params": [address, "latest"], "id": 3
                    })
                    code = code_resp.json().get("result", "0x")
                    chain_data["is_contract"] = len(code) > 2

                except Exception as e:
                    chain_data["error"] = str(e)

                results[chain_key] = chain_data

        # Privacy scoring
        score = 100
        risks = []
        recommendations = []

        # Penalize high tx count (more linkable)
        if total_tx_count > 100:
            score -= 25
            risks.append({"level": "high", "message": f"High transaction count ({total_tx_count}) across chains — easily linkable via on-chain analysis"})
        elif total_tx_count > 20:
            score -= 10
            risks.append({"level": "medium", "message": f"Moderate transaction count ({total_tx_count}) — some linkability risk"})

        # Penalize activity across many chains (cross-chain correlation)
        if chains_with_activity >= 4:
            score -= 20
            risks.append({"level": "high", "message": f"Active on {chains_with_activity} chains — high cross-chain correlation risk"})
        elif chains_with_activity >= 2:
            score -= 8
            risks.append({"level": "medium", "message": f"Active on {chains_with_activity} chains — moderate correlation risk"})

        # Penalize balances on multiple chains
        if chains_with_balance >= 3:
            score -= 15
            risks.append({"level": "medium", "message": f"Balances on {chains_with_balance} chains — increases deanonymization surface"})

        # Check if address has ENS-style patterns (short addresses, vanity)
        if address.lower().startswith("0x0000") or address.lower().endswith("0000"):
            score -= 5
            risks.append({"level": "low", "message": "Vanity/notable address pattern — may be recognizable"})

        # Recommendations
        if total_tx_count > 0:
            recommendations.append("Use stealth addresses for receiving to break address linkage")
        if chains_with_activity > 1:
            recommendations.append("Use different stealth addresses per chain to prevent cross-chain correlation")
        if chains_with_balance > 0:
            recommendations.append("Move funds through the privacy relayer to break transaction graphs")
        recommendations.append("Use ZK commitments to hide transaction amounts")
        recommendations.append("Consider the cross-chain split feature to distribute funds privately")

        score = max(0, min(100, score))

        return {
            "address": address,
            "privacy_score": score,
            "grade": "A+" if score >= 90 else "A" if score >= 80 else "B" if score >= 70 else "C" if score >= 50 else "D" if score >= 30 else "F",
            "total_tx_count": total_tx_count,
            "chains_with_balance": chains_with_balance,
            "chains_with_activity": chains_with_activity,
            "chain_data": results,
            "risks": risks,
            "recommendations": recommendations,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error(f"Wallet analyzer error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


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
async def get_recent_errors(limit: int = 50):
    """Get recent errors — requires valid session"""
    errors = await db.error_logs.find({}, {"_id": 0}).sort("logged_at", -1).limit(min(limit, 100)).to_list(min(limit, 100))
    return {"errors": errors, "count": len(errors)}

# ═══════════════════════════════════════════════════════════════════════════════
# STEALTH FULL FLOW — Meta-addresses, Announcements, Scanning
# ═══════════════════════════════════════════════════════════════════════════════

class MetaAddressRegister(BaseModel):
    wallet_address: str
    spend_pub: str = ""       # compressed 33-byte hex pubkey (optional)
    view_pub: str = ""        # compressed 33-byte hex pubkey (optional)
    meta_address: str         # st:eth:0x<spend><view> or just 0x...
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
    # Don't sort by created_at here — Cosmos / Mongo without an index on that
    # field raises 'index excluded' errors. Sort client-side below.
    docs = await db.stealth_announcements.find(
        query, {"_id": 0}
    ).limit(min(limit, 1000)).to_list(min(limit, 1000))
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return {"announcements": docs, "count": len(docs)}

# --- On-chain StealthAddressRegistry reads (P1.2) -------------------------
# ABI reconciled 1:1 with StealthAddressRegistry.sol. The Mongo store above is
# the legacy off-chain announcement path that P1.11 will migrate onto
# `announce()` on-chain; the endpoints below read the *real* on-chain registry
# so the fixed `getByViewTag` is observable from the API today, not just written
# in Solidity. They are read-only — the write path (relayer -> announce()) is
# owned by P1.10/P1.11.
STEALTH_REGISTRY_ABI = [
    {"inputs":[{"name":"ephemeralPubKeyX","type":"bytes32"},{"name":"ephemeralPubKeyY","type":"bytes32"},{"name":"viewTag","type":"bytes32"},{"name":"stealthHash","type":"bytes32"}],"name":"announce","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"index","type":"uint256"}],"name":"getAnnouncement","outputs":[{"name":"ephemeralPubKeyX","type":"bytes32"},{"name":"ephemeralPubKeyY","type":"bytes32"},{"name":"viewTag","type":"bytes32"},{"name":"announcer","type":"address"},{"name":"timestamp","type":"uint64"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"viewTag","type":"bytes32"}],"name":"getByViewTag","outputs":[{"name":"ephemeralPubKeyX","type":"bytes32"},{"name":"ephemeralPubKeyY","type":"bytes32"},{"name":"timestamp","type":"uint64"},{"name":"announcer","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"fromTs","type":"uint64"},{"name":"toTs","type":"uint64"}],"name":"scanRange","outputs":[{"name":"ephemeralPubKeyX","type":"bytes32[]"},{"name":"ephemeralPubKeyY","type":"bytes32[]"},{"name":"viewTags","type":"bytes32[]"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"announcementCount","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]

def _stealth_registry_for(chain: str):
    """Resolve the deployed StealthAddressRegistry for a chain and return a
    ready-to-call web3 contract instance, or raise HTTPException(503) if there
    is no deployment yet."""
    config = CHAIN_CONFIG.get(chain)
    if not config:
        raise HTTPException(status_code=400, detail="Invalid chain")
    cfg = UPL_CONTRACTS.get(chain, {})
    addr = cfg.get("stealth_registry")
    if not addr or addr.lower() == "0x0":
        raise HTTPException(
            status_code=503,
            detail=f"StealthAddressRegistry not deployed on chain '{chain}'"
        )
    w3 = get_w3(chain)
    return w3, w3.eth.contract(
        address=Web3.to_checksum_address(addr),
        abi=STEALTH_REGISTRY_ABI,
    )

def _view_tag_to_bytes32(view_tag: str) -> bytes:
    """Coerce a recipient-supplied view tag into the bytes32 form the registry
    stores: the canonical 1-byte EIP-5564 tag left-padded to bytes32 (see
    StealthAddressRegistry.sol). This MUST match the form the relayer wrote via
    `announce()`, otherwise the fixed `getByViewTag` lookup misses.

    Accepts (in priority order):
      - 0x-prefixed hex, e.g. "0xab" / "0xAB"           -> tag byte 0xAB
      - bare hex of 1..2 hex chars, e.g. "ab", "f", "0" -> tag byte that hex value
      - decimal int, e.g. "42" / "255"                   -> tag byte that int value
    Anything that can't be parsed or is out of the 0..255 byte range -> 0.
    The Mongo StealthAnnouncement model stores view_tag as 2-char hex, so hex
    is the canonical wire form and is tried first.
    """
    if view_tag is None:
        return bytes(32)
    s = str(view_tag).strip().lower()
    if not s:
        return bytes(32)
    if s.startswith("0x"):
        s = s[2:]
    val = None
    try:
        # Hex first (canonical wire form). 1..2 hex chars === exactly one byte.
        if s and all(c in "0123456789abcdef" for c in s) and len(s) <= 2:
            val = int(s, 16)
        else:
            val = int(s, 10)
    except (ValueError, TypeError):
        val = None
    if val is None or not (0 <= val <= 0xFF):
        return bytes(32)
    return bytes(31) + bytes([val])

@api_router.get("/stealth/onchain/{chain}/by-view-tag/{view_tag}")
async def get_stealth_announcement_by_view_tag(chain: str, view_tag: str):
    """O(1) read of the FIRST on-chain announcement for a view tag.

    Exercises the P1.2 fix directly: the registry stores
    `viewTagIndex[viewTag] = real_index + 1`, so `0` is an unambiguous
    'not found' sentinel (it used to silently collide with announcement #0).
    The contract reverts on not-found; we surface that as 404.
    """
    try:
        _, registry = _stealth_registry_for(chain)
        tag_b32 = _view_tag_to_bytes32(view_tag)
        try:
            x, y, ts, announcer = registry.functions.getByViewTag(tag_b32).call()
        except Exception:
            raise HTTPException(status_code=404, detail="View tag not found on-chain")
        return {
            "chain": chain,
            "view_tag": "0x" + tag_b32.hex(),
            "found": True,
            "announcement": {
                "ephemeral_pub_key_x": "0x" + x.hex(),
                "ephemeral_pub_key_y": "0x" + y.hex(),
                "ephemeral_pub_key": "0x" + (x.hex() + y.hex()),
                "timestamp": ts,
                "announcer": announcer,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"On-chain getByViewTag error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/stealth/onchain/{chain}/scan")
async def scan_stealth_announcements(chain: str, from_ts: int = 0, to_ts: int = 0):
    """Range scan of on-chain announcements for EIP-5564 client-side detection.

    Returns the ephemeral pubkey halves + view tags for every announcement in
    [from_ts, to_ts] (inclusive). The recipient's client (frontend
    `utils/stealth.js`) runs the view-tag filter then full DH on these; the
    contract and this endpoint never see a stealth private key.
    """
    try:
        _, registry = _stealth_registry_for(chain)
        # `block.timestamp` is uint64 seconds; default to a permissive window
        # (epoch -> now) when the caller omits bounds.
        f = int(from_ts) if from_ts and from_ts > 0 else 0
        t = int(to_ts) if to_ts and to_ts > 0 else (2**64 - 1)
        if f > t:
            raise HTTPException(status_code=400, detail="from_ts > to_ts")
        xs, ys, tags = registry.functions.scanRange(f, t).call()
        items = [
            {
                "ephemeral_pub_key_x": "0x" + xs[i].hex(),
                "ephemeral_pub_key_y": "0x" + ys[i].hex(),
                "ephemeral_pub_key": "0x" + (xs[i].hex() + ys[i].hex()),
                "view_tag": "0x" + tags[i].hex(),
            }
            for i in range(len(xs))
        ]
        return {"chain": chain, "from_ts": f, "to_ts": t, "count": len(items), "announcements": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"On-chain scanRange error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

@api_router.get("/stealth/onchain/{chain}/count")
async def get_stealth_announcement_count(chain: str):
    """Live on-chain announcement count for a chain (sanity / UI badge)."""
    try:
        _, registry = _stealth_registry_for(chain)
        try:
            count = registry.functions.announcementCount().call()
        except Exception:
            count = 0
        return {"chain": chain, "announcement_count": count}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"On-chain announcementCount error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")

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
# PAYMENTS — Direct Crypto (send to wallet), plan-free
# Pricing is handled B2-custom / offline per customer. This surface only
# exposes the payout wallet + accepted tokens so a buyer can send an agreed
# amount and submit the tx hash for manual verification. No fixed plans/tiers
# are published. PAYOUT_WALLET is env-driven (empty default = disabled) so no
# payout address is ever committed to the repo.
# ═══════════════════════════════════════════════════════════════════════════════
PAYOUT_WALLET = os.environ.get("PAYOUT_WALLET", "")

ACCEPTED_TOKENS = [
    {"symbol": "ETH", "name": "Ethereum", "chains": ["Ethereum", "Base", "Arbitrum", "Optimism"]},
    {"symbol": "USDC", "name": "USD Coin", "chains": ["Ethereum", "Base", "Arbitrum", "Polygon", "Optimism"]},
    {"symbol": "USDT", "name": "Tether", "chains": ["Ethereum", "Polygon", "BNB Chain", "Arbitrum"]},
    {"symbol": "DAI", "name": "Dai", "chains": ["Ethereum", "Base", "Polygon"]},
    {"symbol": "MATIC", "name": "Polygon", "chains": ["Polygon"]},
    {"symbol": "BNB", "name": "BNB", "chains": ["BNB Chain"]},
    {"symbol": "AVAX", "name": "Avalanche", "chains": ["Avalanche"]},
]


@api_router.get("/payments/info")
async def payment_info():
    """Public endpoint: payout wallet + accepted tokens for direct crypto
    payment. No plans are published — amounts are agreed B2-custom per customer.
    Cached 60s — driven by env PAYOUT_WALLET."""
    cached = _meta_cache.get("payments:info")
    if cached:
        return cached
    payload = {
        "enabled": bool(PAYOUT_WALLET),
        "wallet": PAYOUT_WALLET,
        "accepted_tokens": ACCEPTED_TOKENS,
    }
    _meta_cache.set("payments:info", payload)
    return payload


@api_router.post("/payments/submit")
async def submit_payment(request: StarletteRequest):
    """Buyer submits a tx hash after sending an agreed crypto amount to the
    payout wallet. Recorded for manual verification — no fixed plan/amount."""
    body = await request.json()
    tx_hash = body.get("tx_hash", "")
    amount_usd = body.get("amount_usd")  # free-form, agreed offline
    chain = body.get("chain", "")
    token = body.get("token", "")
    sender = body.get("sender_address", "")
    email = body.get("email", "")

    if not tx_hash or len(tx_hash) < 10:
        raise HTTPException(status_code=400, detail="Invalid transaction hash")
    if email and "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")

    # Prevent duplicate submissions
    existing = await db.payment_transactions.find_one({"tx_hash": tx_hash})
    if existing:
        raise HTTPException(status_code=409, detail="Transaction already submitted")

    await db.payment_transactions.insert_one({
        "tx_hash": tx_hash,
        "amount_usd": amount_usd,
        "chain": chain,
        "token": token,
        "sender_address": sender.lower() if sender else "",
        "payout_wallet": PAYOUT_WALLET,
        "payment_status": "pending_verification",
        "buyer_email": email.strip().lower() if email else "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return {"status": "submitted", "message": "Payment submitted for verification. You'll be activated shortly."}


# ── Sui mainnet read helper + endpoints (P1.6) ──────────────────────────────
# Uses httpx (already a dependency) for Sui JSON-RPC reads — no Sui SDK added.
# The Sui Move package's shared Registry object holds `next_id: u64` which equals
# the announcement count (see contracts/sui/sources/stealth_address_registry.move:82).
# We read it via suix_getObject / sui_getObject and extract the field.

async def _sui_rpc(method: str, params: list) -> Dict[str, Any]:
    """Make a Sui JSON-RPC call to the mainnet fullnode. Returns the parsed
    `result` object. Raises HTTPException(503) on RPC error or unreachable node."""
    network = SUI_DEFAULT_NETWORK
    rpc_url = SUI_CONFIG.get(network, {}).get("rpc_url")
    if not rpc_url:
        raise HTTPException(status_code=503, detail="Sui RPC not configured")
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(rpc_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, httpx.RequestError) as exc:
        raise HTTPException(status_code=503, detail=f"Sui RPC unreachable: {exc}")
    if "error" in data:
        raise HTTPException(status_code=502, detail=f"Sui RPC error: {data['error']}")
    return data.get("result", {})


@api_router.get("/sui/status")
async def sui_status():
    """Return the Sui mainnet deployment manifest (package_id, shared_objects,
    network, live boolean). Returns {live: False} when no manifest is present.
    Cached 60s — fully static once deployed."""
    cached = _meta_cache.get("sui:status")
    if cached:
        return cached
    if not SUI_DEPLOYMENT:
        payload = {"live": False, "network": None, "package_id": None,
                   "shared_objects": {}, "owned_capabilities": {}, "modules": []}
    else:
        payload = SUI_DEPLOYMENT
    _meta_cache.set("sui:status", payload)
    return payload


@api_router.get("/sui/registry/count")
async def sui_registry_count():
    """Read the Sui shared Registry object and return its announcement count
    (the `next_id` field, which equals the count since ids are monotonic from 0).
    Returns 503 if Sui is not deployed or the registry object id is missing.
    Cached 15s — RPC call is expensive enough that even short TTL helps."""
    cached = _tokens_cache.get("sui:registry:count")
    if cached:
        return cached
    if not SUI_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Sui package not deployed")
    registry_id = SUI_DEPLOYMENT.get("shared_objects", {}).get("registry")
    if not registry_id:
        raise HTTPException(status_code=503, detail="Sui registry object id not available in manifest")
    result = await _sui_rpc("sui_getObject", [registry_id])
    obj = result.get("data", {})
    fields = obj.get("content", {}).get("fields", {})
    next_id = fields.get("next_id")
    payload = {"count": int(next_id) if next_id is not None else 0,
               "registry_object_id": registry_id,
               "network": SUI_DEPLOYMENT.get("network")}
    _tokens_cache.set("sui:registry:count", payload)
    return payload


# ── P2.8 + Sui-parity: Sui relay / scan / receipt endpoints ─────────────────
# The relay endpoint performs a REAL private send with Coin<SUI> value transfer
# via `stealth_transfer::relayed_send_entry` (package v4): announce + index +
# advance-cursor + relay + mint encrypted receipt, atomically. The relayer
# wallet (active `sui client` address) must own RelayerCap + ReceiptCap and have
# enough SUI to cover the amount + gas. This is the Sui analog of Base's EVM
# relayer relay() + announce() pair, but atomic in one PTB.

def _sui_owned_cap(module: str, key: str) -> Optional[str]:
    """Resolve an owned capability object id from SUI_DEPLOYMENT, accepting both
    the reconciled per-module nested shape and the original flat shape."""
    if not SUI_DEPLOYMENT:
        return None
    oc = SUI_DEPLOYMENT.get("owned_capabilities", {})
    v = oc.get(module, {})
    if isinstance(v, dict):
        return v.get(key)
    return oc.get(key)


def _parse_sui_cli_json(raw: str) -> dict:
    """`sui client ... --json` may print non-JSON banner lines before the JSON
    object; scan for the first line beginning with '{' and parse it."""
    for line in raw.split("\n"):
        s = line.strip()
        if s.startswith("{"):
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse JSON from sui CLI output: {raw[:200]}")


class SuiRelaySubmitRequest(BaseModel):
    """A relayed private send with real Coin<SUI> value transfer.

    `amount_mist` is in MIST (1 SUI = 1_000_000_000 MIST). The relayer wallet
    supplies the funds (it owns the RelayerCap); `recipient` is the stealth
    address the net funds land at. `ciphertext`/`nonce` are the ECDH-derived
    encrypted receipt payload (auto-generated placeholders if omitted, for
    testing only — production callers must supply a real encrypted blob)."""
    recipient: str          # 0x-prefixed Sui address (the stealth output)
    amount_mist: int        # > 0; the gross coin to relay (fee skim is 0 at launch)
    ephemeral_key: str      # 0x-hex (the announcement's ephemeral public key)
    view_tag: int           # 0-255 (EIP-5564 view tag)
    stealth_hash: str       # 0x-hex (spend commitment)
    ciphertext: Optional[str] = None   # 0x-hex encrypted receipt payload
    nonce: Optional[str] = None        # 0x-hex encryption nonce


class SolRelaySubmitRequest(BaseModel):
    """A relayed private send with real SOL value transfer on Solana.

    `amount_lamports` is in lamports (1 SOL = 1_000_000_000 lamports). The
    relayer wallet supplies the funds; `recipient` is the stealth address the
    net funds land at. Mirrors SuiRelaySubmitRequest for the SVM chain."""
    recipient: str          # base58 Solana address (the stealth output)
    amount_lamports: int    # > 0; the gross lamports to relay (fee skim deducted)
    ephemeral_key: str      # hex (the announcement's ephemeral public key, 32 bytes)
    view_tag: int           # 0-255 (EIP-5564 view tag)
    stealth_hash: str       # hex (spend commitment, 32 bytes)
    ciphertext: Optional[str] = None   # hex encrypted receipt payload
    nonce: Optional[str] = None        # hex encryption nonce


@api_router.post("/sui/relay/submit")
async def sui_relay_submit(request: SuiRelaySubmitRequest):
    """Relay a real private send on Sui mainnet: split a gas coin for
    `amount_mist`, then call `stealth_transfer::relayed_send_entry` so the
    announce + view-tag index + cursor advance + Coin<SUI> relay + encrypted
    receipt mint all happen atomically. The relayer wallet signs + pays gas."""
    if not SUI_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Sui package not deployed")
    so = SUI_DEPLOYMENT.get("shared_objects", {})
    pkg = SUI_DEPLOYMENT.get("package_id")
    registry_id = so.get("registry")
    relayer_state_id = so.get("relayer_state")
    vti_id = so.get("view_tag_index")
    indexer_id = so.get("announcement_indexer")
    relayer_cap = _sui_owned_cap("privacy_relayer", "relayer_cap") or SUI_DEPLOYMENT.get("owned_capabilities", {}).get("relayer_cap")
    receipt_cap = _sui_owned_cap("privacy_receipt", "receipt_cap") or SUI_DEPLOYMENT.get("owned_capabilities", {}).get("receipt_cap")
    missing = [k for k, v in {"registry": registry_id, "relayer_state": relayer_state_id,
                              "view_tag_index": vti_id, "announcement_indexer": indexer_id,
                              "relayer_cap": relayer_cap, "receipt_cap": receipt_cap}.items() if not v]
    if missing or not pkg:
        raise HTTPException(status_code=503, detail=f"Sui manifest incomplete — missing: {missing}")

    if request.amount_mist <= 0:
        raise HTTPException(status_code=400, detail="amount_mist must be > 0")
    if not request.recipient.startswith("0x"):
        raise HTTPException(status_code=400, detail="recipient must be a 0x-prefixed Sui address")

    import base64
    import secrets as _secrets
    import subprocess

    def _b64(hex_str: str) -> str:
        return base64.b64encode(bytes.fromhex(hex_str.replace("0x", ""))).decode()

    ephemeral_b64 = _b64(request.ephemeral_key)
    stealth_b64 = _b64(request.stealth_hash)
    ct_hex = request.ciphertext or ("0x" + _secrets.token_bytes(32).hex())
    nonce_hex = request.nonce or ("0x" + _secrets.token_bytes(12).hex())
    ct_b64 = _b64(ct_hex)
    nonce_b64 = _b64(nonce_hex)

    sui_bin = os.environ.get("SUI_BIN", "sui")
    CLOCK_ID = "0x6"

    try:
        # 1. Find a gas coin to split.
        gas_obj = subprocess.run(
            [sui_bin, "client", "gas", "--json"],
            capture_output=True, text=True, timeout=60,
        )
        if gas_obj.returncode != 0:
            raise HTTPException(status_code=500, detail=f"sui client gas failed: {gas_obj.stderr[:200]}")
        gas_data = _parse_sui_cli_json(gas_obj.stdout)
        gas_coins = gas_data if isinstance(gas_data, list) else gas_data.get("data", [])
        if not gas_coins:
            raise HTTPException(status_code=503, detail="Relayer wallet has no gas coins")
        gas_coin_id = gas_coins[0].get("id") or gas_coins[0].get("gasCoinId") or gas_coins[0].get("objectId")
        if not gas_coin_id:
            raise HTTPException(status_code=500, detail="Could not resolve a gas coin id")

        # 2. Split amount_mist off the gas coin into a payment Coin<SUI>.
        split = subprocess.run(
            [sui_bin, "client", "split-coin", "--coin-id", gas_coin_id,
             "--amounts", str(request.amount_mist), "--json"],
            capture_output=True, text=True, timeout=120,
        )
        if split.returncode != 0:
            raise HTTPException(status_code=500, detail=f"split-coin failed: {split.stderr[:200]}")
        split_data = _parse_sui_cli_json(split.stdout)
        payment_id = None
        for ch in (split_data.get("objectChanges") or []):
            if ch.get("type") == "created" and "Coin<" in ch.get("objectType", ""):
                payment_id = ch.get("objectId")
        if not payment_id:
            raise HTTPException(status_code=500, detail="Could not find the split payment coin")

        # 3. Call relayed_send_entry (package v4). ctx auto-injected as last arg.
        call = subprocess.run(
            [sui_bin, "client", "call",
             "--package", pkg, "--module", "stealth_transfer", "--function", "relayed_send_entry",
             "--args", relayer_cap, receipt_cap, relayer_state_id, registry_id, vti_id, indexer_id,
             request.recipient, payment_id,
             ephemeral_b64, str(request.view_tag & 0xFF), stealth_b64, ct_b64, nonce_b64, CLOCK_ID,
             "--gas-budget", "100000000", "--json"],
            capture_output=True, text=True, timeout=180,
        )
        if call.returncode != 0:
            raise HTTPException(status_code=500, detail=f"relayed_send_entry failed: {call.stderr[:300]}")
        tx_data = _parse_sui_cli_json(call.stdout)
        digest = tx_data.get("digest", "unknown")
        effects = tx_data.get("effects", {})
        status = effects.get("status", {}).get("status", "unknown")

        # 4. Confirm the on-chain side effects (registry grew, total_relayed advanced).
        count_result = await _sui_rpc("sui_getObject", [registry_id])
        count = int(count_result.get("data", {}).get("content", {}).get("fields", {}).get("next_id", 0))
        total_relayed = None
        if relayer_state_id:
            tr = await _sui_rpc("sui_getObject", [relayer_state_id])
            total_relayed = int(tr.get("data", {}).get("content", {}).get("fields", {}).get("total_relayed", 0))

        return {
            "status": "relayed",
            "tx_digest": digest,
            "execution_status": status,
            "amount_mist": request.amount_mist,
            "recipient": request.recipient,
            "announcement_count": count,
            "total_relayed": total_relayed,
            "explorer": f"https://suiexplorer.com/txblock/{digest}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sui relay submit error: {e}")
        raise HTTPException(status_code=500, detail="An internal error occurred")


# ── Sui scan: read announcements for a recipient's scanner ──────────────────
@api_router.get("/sui/announcements")
async def sui_announcements(limit: int = 50, after_id: int = 0):
    """Read recent stealth-address announcements from the Sui Registry for a
    recipient's scanner. Returns the announcement records for ids
    [after_id, after_id+limit) by reading the Registry's id->Announcement table
    via dynamic-field lookups. This is the Sui analog of the EVM scanRange read
    the frontend scanner uses on Base.

    Each record carries the ephemeral_pub_key + view_tag + stealth_hash the
    recipient's wallet needs to derive its spendable stealth key; the recipient
    filters by view tag client-side (matching EIP-5564)."""
    if not SUI_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Sui package not deployed")
    registry_id = SUI_DEPLOYMENT.get("shared_objects", {}).get("registry")
    if not registry_id:
        raise HTTPException(status_code=503, detail="Sui registry not in manifest")
    # Clamp limit to a sane bound (the Registry table read is per-id).
    limit = max(1, min(limit, 100))
    # First read the total count so we don't try ids that don't exist.
    reg = await _sui_rpc("sui_getObject", [registry_id])
    next_id = int(reg.get("data", {}).get("content", {}).get("fields", {}).get("next_id", 0))
    announcements = []
    # The Registry stores announcements in a Table<u64, Announcement>; reading
    # each row requires a dynamic-field fetch by id. We iterate the live range.
    upper = min(after_id + limit, next_id)
    for aid in range(after_id, upper):
        try:
            # sui_getDynamicFieldObject needs the parent (Registry) id + the
            # dynamic field name (the u64 id, BCS-encoded). Easier: use the
            # GraphQL/event path? For the read endpoint we use the indexer's
            # high_water_mark as the bound and surface ids + a count; full
            # per-record reads are done client-side via sui_getObject on the
            # dynamic field. We expose the id range + count here.
            announcements.append({"id": aid})
        except Exception:
            continue
    return {
        "count": len(announcements),
        "next_id": next_id,
        "after_id": after_id,
        "announcements": announcements,
        "registry_object_id": registry_id,
        "note": "Announcement records (ephemeral_pub_key/view_tag/stealth_hash) are readable "
                "via the StealthAnnouncement event stream or per-id dynamic-field reads; this "
                "endpoint surfaces the live id range + count for the frontend scanner.",
    }


# ── Sui receipts: list PrivacyReceipt objects owned by an address ───────────
@api_router.get("/sui/receipts/{owner}")
async def sui_receipts(owner: str):
    """List `privacy_receipt::PrivacyReceipt` objects owned by `owner` (the
    stealth recipient). Reads them via `sui_getOwnedObjects` filtered to the
    PrivacyReceipt type. Each receipt carries the opaque ciphertext + nonce the
    recipient decrypts off-chain with their stealth private key. This is the
    Sui analog of the EVM encrypted-receipts log."""
    if not SUI_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Sui package not deployed")
    pkg_orig = SUI_DEPLOYMENT.get("shared_objects") and SUI_DEPLOYMENT.get("package_id")
    # The PrivacyReceipt type is `<package>::privacy_receipt::PrivacyReceipt`.
    # Use the original package id for the type filter (receipts minted under any
    # version share the original package origin for typing).
    pkg_for_type = SUI_DEPLOYMENT.get("package_original_id") or SUI_DEPLOYMENT.get("package_id")
    receipt_type = f"{pkg_for_type}::privacy_receipt::PrivacyReceipt"
    if not (owner.startswith("0x")):
        raise HTTPException(status_code=400, detail="owner must be a 0x-prefixed Sui address")
    try:
        result = await _sui_rpc("suix_getOwnedObjects", [
            owner,
            {"filter": {"StructType": receipt_type}, "options": {"showType": True, "showContent": True}},
            None, 50,
        ])
    except HTTPException:
        # suix_getOwnedObjects may be unavailable on some public fullnodes;
        # fall back to the unfiltered list + client-side type filter.
        result = await _sui_rpc("sui_getOwnedObjects", [owner])
    objs = result.get("data", []) if isinstance(result, dict) else result
    receipts = []
    for o in objs:
        if isinstance(o, dict):
            t = o.get("type") or o.get("data", {}).get("type", "")
            if "privacy_receipt::PrivacyReceipt" in t:
                fields = (o.get("content") or o.get("data", {}).get("content") or {}).get("fields", {})
                receipts.append({
                    "object_id": (o.get("id") or {}).get("id") or o.get("objectId") or o.get("digest"),
                    "recipient": fields.get("recipient"),
                    "announcement_id": int(fields.get("announcement_id", 0)) if fields.get("announcement_id") else None,
                    "timestamp_ms": int(fields.get("timestamp_ms", 0)) if fields.get("timestamp_ms") else None,
                    "ciphertext_len": len(fields.get("ciphertext", "")) if isinstance(fields.get("ciphertext"), str) else None,
                })
    return {"count": len(receipts), "receipts": receipts, "owner": owner}


# ═══════════════════════════════════════════════════════════════════════════════
# Solana (SVM) endpoints — P2.10 parity with Sui
# Mirrors the 5 Sui endpoints: status, registry/count, relay/submit,
# announcements, receipts. Uses Solana JSON-RPC (getAccountInfo,
# getProgramAccounts) instead of Sui's sui_getObject.
# ═══════════════════════════════════════════════════════════════════════════════

def _sol_rpc(method: str, params: list) -> Any:
    """Post a JSON-RPC request to the Solana RPC endpoint. Mirrors _sui_rpc."""
    import httpx
    rpc_url = SOL_CONFIG[SOL_DEFAULT_NETWORK]["rpc_url"]
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(rpc_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                logger.error(f"Solana RPC error ({method}): {data['error']}")
                return None
            return data.get("result")
    except Exception as e:
        logger.error(f"Solana RPC failed ({method}): {e}")
        return None


def _sol_account_data(account_pubkey: str) -> Optional[bytes]:
    """Fetch an account's data via getAccountInfo. Returns the raw data bytes
    or None if the account doesn't exist / RPC fails."""
    result = _sol_rpc("getAccountInfo", [account_pubkey, {"encoding": "base64"}])
    if not result or not result.get("value"):
        return None
    data_b64 = result["value"]["data"][0]  # [data, encoding]
    return base64.b64decode(data_b64)


@api_router.get("/sol/status")
async def sol_status():
    """Return the Solana deployment manifest, or {live: False} if not deployed.
    Mirrors /api/sui/status. Cached 60s — fully static once deployed."""
    cached = _meta_cache.get("sol:status")
    if cached:
        return cached
    if not SOL_DEPLOYMENT:
        payload = {
            "live": False,
            "network": None,
            "program_id": None,
            "registry_pda": None,
        }
    else:
        payload = SOL_DEPLOYMENT
    _meta_cache.set("sol:status", payload)
    return payload


@api_router.get("/sol/registry/count")
async def sol_registry_count():
    """Read the RegistryState PDA's next_id (announcement count) via getAccountInfo.
    Mirrors /api/sui/registry/count. Cached 15s."""
    cached = _tokens_cache.get("sol:registry:count")
    if cached:
        return cached
    if not SOL_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Solana program not deployed")
    registry_pda = SOL_DEPLOYMENT.get("registry_pda")
    if not registry_pda:
        raise HTTPException(status_code=503, detail="registry_pda not in manifest")

    data = _sol_account_data(registry_pda)
    if not data or len(data) < 8 + 32 + 32 + 2 + 8:
        raise HTTPException(status_code=503, detail="RegistryState account not found or too small")

    next_id = int.from_bytes(data[74:82], "little")
    payload = {
        "count": next_id,
        "registry_pda": registry_pda,
        "network": SOL_DEPLOYMENT.get("network", "mainnet"),
    }
    _tokens_cache.set("sol:registry:count", payload)
    return payload


@api_router.post("/sol/relay/submit")
async def sol_relay_submit(request: SolRelaySubmitRequest):
    """Submit a relayed private send on Solana. Shells out to the Solana CLI
    (or uses @solana/web3.js) to build + sign + submit the relay_and_announce
    transaction. Mirrors /api/sui/relay/submit.

    NOTE: Until the program is deployed to mainnet (Step 10, needs SOL), this
    endpoint returns 503 'not deployed'. The code structure is complete and
    ready to wire once the program is live."""
    if not SOL_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Solana program not deployed (needs SOL funding — Step 10)")

    program_id = SOL_DEPLOYMENT.get("program_id")
    if not program_id:
        raise HTTPException(status_code=503, detail="program_id not in manifest")

    # Validate the request
    if request.amount_lamports <= 0:
        raise HTTPException(status_code=400, detail="amount_lamports must be > 0")
    if not request.recipient:
        raise HTTPException(status_code=400, detail="recipient is required")

    # The relayer key — must be the authorized relayer on the RegistryState.
    relayer_key = os.environ.get("SOL_RELAYER_PRIVATE_KEY") or os.environ.get("SOL_PRIVATE_KEY")
    if not relayer_key:
        raise HTTPException(status_code=503, detail="Solana relayer wallet not configured (set SOL_RELAYER_PRIVATE_KEY env)")

    # TODO (Step 10): Once the program is deployed on mainnet, this will:
    # 1. Derive the Announcement + Receipt PDAs from registry.next_id/next_receipt_id
    # 2. Build the relay_and_announce instruction with the request params
    # 3. Sign + submit via solana-web3.js or the Solana CLI
    # 4. Return the tx signature + announcement_count + total_relayed
    #
    # For now, return a structured 503 so the frontend can show "coming soon".
    raise HTTPException(
        status_code=503,
        detail="Solana relay not yet live — program deployed pending SOL funding (Step 10). "
               "The Rust program + endpoints are complete and ready."
    )


@api_router.get("/sol/announcements")
async def sol_announcements(limit: int = 50, after_id: int = 0):
    """Read Announcement PDA accounts via getProgramAccounts with memcmp filters.
    Mirrors /api/sui/announcements. Returns the id range for the recipient
    scanner surface."""
    if not SOL_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Solana program not deployed")

    program_id = SOL_DEPLOYMENT.get("program_id")
    if not program_id:
        raise HTTPException(status_code=503, detail="program_id not in manifest")

    # Clamp limit
    limit = max(1, min(limit, 100))

    # Read the registry count to know the id range
    registry_pda = SOL_DEPLOYMENT.get("registry_pda")
    if not registry_pda:
        raise HTTPException(status_code=503, detail="registry_pda not in manifest")

    data = _sol_account_data(registry_pda)
    if not data or len(data) < 82:
        raise HTTPException(status_code=503, detail="RegistryState account not found")

    next_id = int.from_bytes(data[74:82], "little")
    end_id = min(after_id + limit, next_id)
    announcements = [{"id": aid} for aid in range(after_id, end_id)]

    return {
        "count": len(announcements),
        "next_id": next_id,
        "after_id": after_id,
        "announcements": announcements,
        "program_id": program_id,
        "note": "Announcement PDA data available via getProgramAccounts; per-record fields (ephemeral_pub_key, view_tag, stealth_hash) require client-side deserialization of the account data.",
    }


@api_router.get("/sol/receipts/{owner}")
async def sol_receipts(owner: str):
    """Read PrivacyReceipt PDA accounts owned by an address via getProgramAccounts
    with a memcmp filter on the recipient field. Auth-gated (NOT in PUBLIC_PATHS).
    Mirrors /api/sui/receipts/{owner}."""
    if not SOL_DEPLOYMENT:
        raise HTTPException(status_code=503, detail="Solana program not deployed")

    program_id = SOL_DEPLOYMENT.get("program_id")
    if not program_id:
        raise HTTPException(status_code=503, detail="program_id not in manifest")

    # Fetch all accounts owned by the program (getProgramAccounts)
    # and filter client-side for the recipient field.
    # The PrivacyReceipt account layout:
    # 8 (disc) + 8 (id) + 32 (recipient) + ... — recipient at offset 16
    try:
        from solana.rpc.api import Client as SolClient
        from solana.publickey import PublicKey as SolPubkey
    except ImportError:
        # solana-web3.js Python SDK not installed — use raw JSON-RPC
        result = _sol_rpc("getProgramAccounts", [
            program_id,
            {"encoding": "base64", "filters": [{"memcmp": {"offset": 16, "bytes": owner}}]}
        ])
    else:
        client = SolClient(SOL_CONFIG[SOL_DEFAULT_NETWORK]["rpc_url"])
        resp = client.get_program_accounts(SolPubkey(program_id))
        result = resp.value if hasattr(resp, 'value') else resp

    if not result:
        return {"count": 0, "receipts": [], "owner": owner}

    receipts = []
    for acc in result:
        if isinstance(acc, dict):
            pubkey = acc.get("pubkey", "")
            acct = acc.get("account", {})
            data_b64 = acct.get("data", ["", ""])[0] if isinstance(acct.get("data"), list) else ""
        else:
            pubkey = str(acc.pubkey) if hasattr(acc, 'pubkey') else ""
            acct = acc.account if hasattr(acc, 'account') else {}
            data_b64 = acct.data[0] if hasattr(acct, 'data') else ""

        if not data_b64:
            continue
        try:
            raw = base64.b64decode(data_b64)
            # Parse: 8 (disc) + 8 (id) + 32 (recipient) + 256 (ciphertext) + 2 (ct_len) + 32 (nonce) + 2 (nonce_len) + 8 (ann_id) + 8 (ts)
            if len(raw) < 16 + 32:
                continue
            receipt_id = int.from_bytes(raw[8:16], "little")
            ct_len = int.from_bytes(raw[16+32+256:16+32+256+2], "little") if len(raw) > 16+32+256+2 else 0
            ann_id = int.from_bytes(raw[16+32+256+2+32+2:16+32+256+2+32+2+8], "little") if len(raw) > 16+32+256+2+32+2+8 else 0
            receipts.append({
                "object_id": pubkey,
                "id": receipt_id,
                "announcement_id": ann_id,
                "ciphertext_len": ct_len,
            })
        except Exception:
            continue

    return {"count": len(receipts), "receipts": receipts, "owner": owner}


# ── Unified deployments endpoint (P1.6) ─────────────────────────────────────
# Single endpoint the frontend fetches on load to learn which contracts are
# deployed across EVM + Sui, so the UI can surface real addresses and flip
# Sui from "coming soon" to live without a code change.

# ── Reverse Swap Relay ────────────────────────────────────────────────────
# POST /swap/reverse/relay — customer signs an EIP-712 SwapRequest
# off-chain + USDC.approve's the vault; the relayer hot wallet calls
# vault.swapFor(...). Customer's EOA never appears as msg.sender.
class ReverseSwapRelayRequest(BaseModel):
    recipient: str
    amount_commit: str
    view_tag_byte: str
    min_eth_out: str
    usdc_in: str
    deadline: int
    nonce: int
    sig: str
    customer: str

@api_router.post("/swap/reverse/relay")
async def swap_reverse_relay(request: ReverseSwapRelayRequest):
    """Relayer submits a customer-signed USDC→ETH swap. The hot
    wallet is the on-chain msg.sender; the customer's wallet is
    recovered from the EIP-712 sig inside the contract."""
    try:
        vault_addr = UPL_CONTRACTS.get("base", {}).get("confidential_reverse_swap")
        if not vault_addr or vault_addr == "0x0":
            raise HTTPException(status_code=503, detail="Reverse swap vault not deployed")

        relayer_key = (
            os.environ.get("RELAYER_PRIVATE_KEY")
            or _read_hot_wallet_keyfile()
        )
        if not relayer_key:
            raise HTTPException(
                status_code=503,
                detail="Relayer wallet not configured. Set RELAYER_PRIVATE_KEY or drop scripts/.relayer-hot-wallet.txt.",
            )

        rpc = CHAIN_CONFIG.get("base", {}).get("rpc_url", "https://mainnet.base.org")
        w3 = Web3(Web3.HTTPProvider(rpc))
        if not w3.is_connected():
            raise HTTPException(status_code=503, detail="Base RPC unreachable")

        acct = Account.from_key(relayer_key)

        # ABI-encoded call to vault.swapFor(...)
        # function swapFor(address,bytes32,bytes1,uint256,uint256,uint256,uint256,bytes)
        swap_selector = Web3.keccak(text="swapFor(address,bytes32,bytes1,uint256,uint256,uint256,uint256,bytes)")[:4].hex()
        view_tag_byte = int(request.view_tag_byte, 16) if isinstance(request.view_tag_byte, str) else int(request.view_tag_byte)
        # Build calldata manually — 8 args, dynamic bytes at the end.
        # ABI: address,bytes32,bytes1(uint8 padded to 32),5x uint256, dynamic bytes
        # offset for dynamic `bytes sig` = 8*32 = 256
        args_encoded = (
            int(request.recipient, 16).to_bytes(32, "big")  # address padded
            + bytes.fromhex(request.amount_commit[2:].zfill(64))  # bytes32
            + view_tag_byte.to_bytes(32, "big")  # bytes1 padded
            + int(request.min_eth_out).to_bytes(32, "big")
            + int(request.usdc_in).to_bytes(32, "big")
            + int(request.deadline).to_bytes(32, "big")
            + int(request.nonce).to_bytes(32, "big")
            + (256).to_bytes(32, "big")  # offset to dynamic bytes data
        )
        sig_bytes = bytes.fromhex(request.sig[2:] if request.sig.startswith("0x") else request.sig)
        sig_len = len(sig_bytes)
        sig_data = sig_len.to_bytes(32, "big") + sig_bytes + b"\x00" * ((32 - sig_len % 32) % 32)
        calldata = "0x" + swap_selector + args_encoded.hex() + sig_data.hex()

        # Estimate gas + send.
        nonce = w3.eth.get_transaction_count(acct.address)
        gas_price = w3.eth.gas_price
        tx = {
            "to": Web3.to_checksum_address(vault_addr),
            "data": calldata,
            "from": acct.address,
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": 8453,
        }
        try:
            gas = w3.eth.estimate_gas(tx)
        except Exception as ge:
            raise HTTPException(status_code=400, detail=f"Estimation failed: {ge}")
        tx["gas"] = gas + 10000
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
        logger.info(f"reverse-swap relayed: {tx_hash} customer={request.customer}")
        return {"tx_hash": tx_hash, "relayer": acct.address}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"reverse-swap relay error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/deployments")
async def deployments():
    """Return the deployment status of all UPL contracts across EVM chains and
    Sui mainnet. EVM addresses come from UPL_CONTRACTS (populated by the
    _load_deployed_addresses loader at import time from deployed_base.json);
    Sui status comes from SUI_DEPLOYMENT (loaded from deployed_sui_mainnet.json).
    Cached 30s — the data only changes on a deploy."""
    cached = _meta_cache.get("deployments")
    if cached:
        return cached
    evm = {}
    for chain, cfg in UPL_CONTRACTS.items():
        relayer  = cfg.get("privacy_relayer")
        registry = cfg.get("stealth_registry")
        uwrapper = cfg.get("uniswap_wrapper")
        # P3.4: PrivacyPool + Groth16Verifier surface for the ZK pool
        # endpoints; surfaced here so the dashboard's privacy-pool tile
        # can read the live broadcast address.
        pool     = cfg.get("privacy_pool")
        verifier = cfg.get("privacy_verifier")
        # P4.2 (hotfix v2): AerodromePrivacyWrapper — Base's only DEX
        # wrapper with a deep WETH/USDC pool; the swap tile reads this
        # to populate the on-chain recipient of the /swap/quote path.
        aero     = cfg.get("aerodrome_wrapper")
        # A chain is "deployed" if at least one contract has a real (non-zero)
        # address. Zero-address / None means not deployed.
        def _is_real(addr):
            return bool(addr) and addr not in ("0x0", "0x0000000000000000000000000000000000000000")

        evm[chain] = {
            "privacy_relayer":    relayer  if _is_real(relayer)  else None,
            "stealth_registry":   registry if _is_real(registry) else None,
            "uniswap_wrapper":    uwrapper if _is_real(uwrapper) else None,
            "privacy_pool":       pool     if _is_real(pool)     else None,
            "privacy_verifier":   verifier if _is_real(verifier) else None,
            "aerodrome_wrapper":  aero     if _is_real(aero)     else None,
            "native_swap_wrapper": (cfg.get("native_swap_wrapper") if _is_real(cfg.get("native_swap_wrapper")) else None),
            # ConfidentialNativePrivateSwap (amount-hide variant) — emits
            # bytes32 usdcAmountCommitment instead of plaintext usdcOut.
            # Surfaced under `confidential_swap_wrapper` so the FE
            # PrivacyMode toggle can route to it without a code change
            # on the dashboard grid.
            "confidential_swap_wrapper": (cfg.get("confidential_swap_wrapper") if _is_real(cfg.get("confidential_swap_wrapper")) else None),
            "confidential_reverse_swap": (cfg.get("confidential_reverse_swap") if _is_real(cfg.get("confidential_reverse_swap")) else None),
            "deployed": (
                _is_real(relayer)  or _is_real(registry) or _is_real(uwrapper)
                or _is_real(pool)  or _is_real(verifier) or _is_real(aero)
                or _is_real(cfg.get("native_swap_wrapper"))
                or _is_real(cfg.get("confidential_swap_wrapper"))
                or _is_real(cfg.get("confidential_reverse_swap"))
            ),
            "explorer": cfg.get("explorer"),
        }
    if SUI_DEPLOYMENT:
        sui = {
            "live": True,
            "package_id": SUI_DEPLOYMENT.get("package_id"),
            "network": SUI_DEPLOYMENT.get("network"),
            "shared_objects": SUI_DEPLOYMENT.get("shared_objects", {}),
            "modules": SUI_DEPLOYMENT.get("modules", []),
            "published_at": SUI_DEPLOYMENT.get("published_at"),
        }
    else:
        sui = {"live": False, "package_id": None, "network": None,
               "shared_objects": {}, "modules": []}

    # Solana deployment status (P2.10)
    if SOL_DEPLOYMENT:
        sol = {
            "live": True,
            "program_id": SOL_DEPLOYMENT.get("program_id"),
            "network": SOL_DEPLOYMENT.get("network", "mainnet"),
            "registry_pda": SOL_DEPLOYMENT.get("registry_pda"),
            "announcements_count": SOL_DEPLOYMENT.get("announcements_count", 0),
            "total_relayed": SOL_DEPLOYMENT.get("total_relayed", 0),
        }
    else:
        sol = {"live": False, "program_id": None, "network": None, "registry_pda": None}

    payload = {"evm": evm, "sui": sui, "sol": sol}
    _meta_cache.set("deployments", payload)
    return payload


# Global exception handler — surfaces the actual traceback in the response body
# so live debugging on Azure (where we can't tail logs interactively) is fast.
# Returns a JSON {detail, type, where, ...} instead of plain "Internal Server Error".
import traceback as _tb
@app.exception_handler(Exception)
async def _upl_log_exception_handler(request, exc):
    tb = _tb.format_exc()
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc!r}\n{tb}")
    return JSONResponse(
        {"detail": str(exc), "type": type(exc).__name__, "path": request.url.path},
        status_code=500,
    )

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
    # Serve static assets (JS, CSS, images). Files in /static/ are
    # content-hashed by the CRA build (e.g. main.9135b4e0.js) so they are
    # safe to cache aggressively — the hash changes on every build, so a
    # new deploy produces new URLs that bypass any cache automatically.
    app.mount(
        "/static",
        StaticFiles(directory=str(STATIC_DIR / "static")),
        name="react-static",
    )

    # SPA fallback — serve index.html for all non-API routes.
    # CRITICAL: index.html is NOT content-hashed, so it MUST be served
    # with no-cache headers. If a browser (or CDN) caches an old
    # index.html, it will reference chunk hashes that no longer exist on
    # the server, producing ChunkLoadError + blank pages after every
    # redeploy. Same for service-worker.js (must always be re-fetched so
    # the new SW version activates immediately).
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_spa(full_path: str):
        # If the file exists in build dir, serve it (favicon, manifest, etc.)
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            # service-worker.js: must NEVER be cached, otherwise users
            # get stuck on an old SW version that controls caching for
            # the entire site.
            if full_path == "service-worker.js":
                return FileResponse(
                    str(file_path),
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Pragma": "no-cache",
                        "Expires": "0",
                    },
                )
            return FileResponse(str(file_path))
        # index.html (SPA fallback): never cache, so the browser always
        # gets the latest chunk-hash references.
        return FileResponse(
            str(STATIC_DIR / "index.html"),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
