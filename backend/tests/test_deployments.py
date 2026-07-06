"""
Unit tests for the P1.6 deployment endpoints + Sui manifest loader.

Tests:
  - /api/deployments with no manifests present (EVM placeholders, Sui not live)
  - /api/deployments with a Sui mainnet manifest (Sui live=True, package_id surfaced)
  - /api/sui/status not-deployed + deployed
  - _load_deployed_sui validation: valid id, invalid id, missing file, malformed JSON

The Sui loader (_load_deployed_sui) runs at import time and binds SUI_DEPLOYMENT
once. To test different manifest states we reload the server module with the
UPL_DEPLOYED_SUI_JSON env var pointing at a temp manifest file.
"""

import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# A valid Sui mainnet manifest the loader should accept.
VALID_SUI_MANIFEST = {
    "network": "mainnet",
    "sui_cli_version": "sui 1.74.0-mainnet",
    "published_at": "2026-06-30T00:00:00Z",
    "package_id": "0x" + "a" * 64,
    "modules": ["stealth_address_registry", "privacy_relayer"],
    "shared_objects": {
        "registry": "0x" + "b" * 64,
        "relayer_state": "0x" + "c" * 64,
    },
    "owned_capabilities": {
        "admin_cap": "0x" + "d" * 64,
        "relayer_cap": "0x" + "e" * 64,
        "receipt_cap": "0x" + "f" * 64,
        "upgrade_cap": "0x" + "1" * 64,
    },
    "publisher_address": "0x" + "2" * 64,
}


def _write_temp_manifest(data: dict) -> str:
    """Write a manifest dict to a temp JSON file and return its path."""
    fd, path = tempfile.mkstemp(suffix=".json", prefix="sui_manifest_")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return path


def _reload_server(sui_manifest_path: str | None = None):
    """Reload the server module with UPL_DEPLOYED_SUI_JSON set (or cleared).
    Returns the reloaded module so tests can inspect SUI_DEPLOYMENT."""
    # Clear any prior env override
    os.environ.pop("UPL_DEPLOYED_SUI_JSON", None)
    if sui_manifest_path:
        os.environ["UPL_DEPLOYED_SUI_JSON"] = sui_manifest_path

    # Ensure required env vars are present (conftest sets defaults, but reload
    # happens after conftest so re-assert them).
    os.environ.setdefault("MONGO_URL", "mongodb://fake:27017")
    os.environ.setdefault("DB_NAME", "upl_test_database")
    os.environ.setdefault("ACCESS_CODE", "test-access-code-123")
    os.environ.setdefault("PAYOUT_WALLET", "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B")

    backend_dir = os.path.join(os.path.dirname(__file__), "..")
    if backend_dir not in sys.path:
        sys.path.insert(0, os.path.abspath(backend_dir))

    # Force a fresh import so the loader re-reads the env var.
    if "server" in sys.modules:
        del sys.modules["server"]
    import server as server_module
    importlib.reload(server_module)
    return server_module


# ── Tests: /api/deployments with NO manifests present ─────────────────────

class TestDeploymentsNoManifests:
    """Default state: no deployed_base.json, no deployed_sui_mainnet.json."""

    def test_deployments_returns_200(self, client):
        resp = client.get("/api/deployments")
        assert resp.status_code == 200

    def test_deployments_sui_structure(self, client):
        """Sui section should have the right structure whether or not a manifest
        is committed. After P2.7 the manifest IS committed with real addresses."""
        data = client.get("/api/deployments").json()
        assert "live" in data["sui"]
        assert "package_id" in data["sui"]
        # If live, package_id should be a valid Sui object id
        if data["sui"]["live"]:
            assert data["sui"]["package_id"] is not None
            assert data["sui"]["package_id"].startswith("0x")

    def test_deployments_evm_chains_present(self, client):
        data = client.get("/api/deployments").json()
        # The 7 EVM chains should all appear.
        assert "base" in data["evm"]
        # Structure check — deployed depends on whether deployed_base.json
        # is committed with real addresses (it is now, after P1.9).
        assert "deployed" in data["evm"]["base"]
        assert "privacy_relayer" in data["evm"]["base"]

    def test_deployments_evm_base_deployed_with_real_addresses(self, client):
        """If deployed_base.json is committed with real Base mainnet addresses
        (which it is after P1.9), base should show deployed=True with real addrs."""
        data = client.get("/api/deployments").json()
        base = data["evm"]["base"]
        if base["deployed"]:
            # Real addresses should be non-null checksummed addresses.
            assert base["privacy_relayer"] is not None
            assert base["privacy_relayer"].startswith("0x")
            assert len(base["privacy_relayer"]) == 42
            assert base["stealth_registry"] is not None
            assert base["stealth_registry"].startswith("0x")

    def test_deployments_evm_has_explorer(self, client):
        data = client.get("/api/deployments").json()
        assert data["evm"]["base"]["explorer"] == "https://basescan.org"

    def test_deployments_evm_base_p4_contracts_present(self, client):
        """Customer pilot lives on Base; all P4.1 + P4.2 contracts must be
        surfaced in /api/deployments so the dashboard's send-receive-swap
        flow can reach them.

        This locks in the broadcast addresses for the customer-facing
        surface area: if a future commit silently aliases or 'fixes' any
        of these addresses (e.g. points the swap UI back at a wrapper
        that reverts), this test fires before the customer catches it."""
        data = client.get("/api/deployments").json()
        base = data["evm"]["base"]
        if not base["deployed"]:
            pytest.skip("Base manifest not deployed in this env")
        # P4.1 multi-denom PrivacyPool (send-flow + receive-flow both
        # depend on it transitively via the network propagation path).
        assert base.get("privacy_pool") == "0x3F0b23Aca0624981a503e8f042db2F3884D0C89C"
        # P4.1 Groth16Verifier backing the ZK pool (deploy independently
        # of the pool so verifying the surface area independently catches
        # any drift between the two addresses).
        assert base.get("privacy_verifier") == "0x838b7c20b1a97cAA6379542d03983b4571275679"
        # P4.2 AerodromePrivacyWrapper (post-hotfix v2 — the swap tile
        # routes here; v1 wraps a 3-field Route struct that reverts at
        # Aerodrome Router with empty error data, so this exact address
        # matters more than any other).
        assert base.get("aerodrome_wrapper") == "0xe896e6f51af137c32db7eb4e3b2de795d392a646"
        # UniswapPrivacyWrapper is also live on Base; the multi-DEX picker
        # surfaces it for non-USDC pairs (no WETH/USDC pool on Uniswap V3
        # per the P1.13 finding; do NOT promote it to default).
        assert base.get("uniswap_wrapper") == "0x9C30cdCd73347BF18A5bD424C37E5714e2606362"
        # Each address must be a valid 0x-prefixed 20-byte hex string.
        for k in ["privacy_pool", "privacy_verifier", "aerodrome_wrapper", "uniswap_wrapper"]:
            v = base.get(k)
            assert v is not None
            assert v.startswith("0x") and len(v) == 42, f"{k}={v!r} not a 0x-prefixed 20-byte address"


# ── Tests: /api/sui/status (handles both deployed and not-deployed) ────────

class TestSuiStatus:

    def test_sui_status_returns_200(self, client):
        resp = client.get("/api/sui/status")
        assert resp.status_code == 200

    def test_sui_status_structure(self, client):
        """Status should have the right structure. After P2.7 the Sui manifest
        IS committed, so live may be True with a real package_id."""
        data = client.get("/api/sui/status").json()
        assert "live" in data
        assert "package_id" in data
        if data["live"]:
            assert data["package_id"] is not None
            assert data["package_id"].startswith("0x")

    def test_sui_registry_count(self, client):
        """If Sui is deployed, count should return 200 with a count.
        If not deployed, should return 503."""
        resp = client.get("/api/sui/registry/count")
        # After P2.7, Sui IS deployed → 200 with count
        if resp.status_code == 200:
            data = resp.json()
            assert "count" in data
            assert isinstance(data["count"], int)
        else:
            assert resp.status_code == 503


# ── Tests: Sui loader validation (unit-level, no TestClient) ──────────────

class TestSuiLoaderValidation:

    def test_valid_manifest_loads(self):
        """A well-formed manifest should produce a live SUI_DEPLOYMENT."""
        path = _write_temp_manifest(VALID_SUI_MANIFEST)
        try:
            mod = _reload_server(sui_manifest_path=path)
            assert mod.SUI_DEPLOYMENT is not None
            assert mod.SUI_DEPLOYMENT["live"] is True
            assert mod.SUI_DEPLOYMENT["package_id"] == VALID_SUI_MANIFEST["package_id"]
            assert mod.SUI_DEPLOYMENT["shared_objects"]["registry"] == VALID_SUI_MANIFEST["shared_objects"]["registry"]
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)  # restore default state

    def test_missing_file_returns_none(self):
        """A non-existent manifest path should return None (Sui not deployed)."""
        mod = _reload_server(sui_manifest_path="/nonexistent/path/sui_manifest.json")
        assert mod.SUI_DEPLOYMENT is None
        _reload_server(sui_manifest_path=None)  # restore

    def test_malformed_json_returns_none(self):
        """A malformed JSON file should return None, not crash."""
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            f.write("{ this is not valid json }}}")
        try:
            mod = _reload_server(sui_manifest_path=path)
            assert mod.SUI_DEPLOYMENT is None
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)

    def test_invalid_package_id_returns_none(self):
        """A package_id that isn't a valid Sui object id should return None."""
        bad = dict(VALID_SUI_MANIFEST)
        bad["package_id"] = "0xshort"  # too short for a Sui id
        path = _write_temp_manifest(bad)
        try:
            mod = _reload_server(sui_manifest_path=path)
            assert mod.SUI_DEPLOYMENT is None
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)

    def test_non_dict_manifest_returns_none(self):
        """A JSON array (not object) should return None."""
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(["not", "an", "object"], f)
        try:
            mod = _reload_server(sui_manifest_path=path)
            assert mod.SUI_DEPLOYMENT is None
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)


# ── Tests: /api/sui/status + /api/deployments WITH a valid manifest ───────

class TestSuiDeployedState:
    """When a valid Sui manifest is present, the endpoints should report live=True."""

    def test_sui_status_live_with_manifest(self):
        path = _write_temp_manifest(VALID_SUI_MANIFEST)
        try:
            mod = _reload_server(sui_manifest_path=path)
            with TestClient(mod.app) as c:
                resp = c.get("/api/sui/status")
                assert resp.status_code == 200
                data = resp.json()
                assert data["live"] is True
                assert data["package_id"] == VALID_SUI_MANIFEST["package_id"]
                assert data["network"] == "mainnet"
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)

    def test_deployments_sui_live_with_manifest(self):
        path = _write_temp_manifest(VALID_SUI_MANIFEST)
        try:
            mod = _reload_server(sui_manifest_path=path)
            with TestClient(mod.app) as c:
                data = c.get("/api/deployments").json()
                assert data["sui"]["live"] is True
                assert data["sui"]["package_id"] == VALID_SUI_MANIFEST["package_id"]
                assert "registry" in data["sui"]["shared_objects"]
        finally:
            os.unlink(path)
            _reload_server(sui_manifest_path=None)
