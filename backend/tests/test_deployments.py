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

    def test_deployments_sui_not_live(self, client):
        data = client.get("/api/deployments").json()
        assert data["sui"]["live"] is False
        assert data["sui"]["package_id"] is None

    def test_deployments_evm_chains_present(self, client):
        data = client.get("/api/deployments").json()
        # The 7 EVM chains should all appear, none deployed (placeholder addresses).
        assert "base" in data["evm"]
        assert data["evm"]["base"]["deployed"] is False
        # Placeholder addresses → normalized to None by the loader.
        assert data["evm"]["base"]["privacy_relayer"] is None

    def test_deployments_evm_has_explorer(self, client):
        data = client.get("/api/deployments").json()
        assert data["evm"]["base"]["explorer"] == "https://basescan.org"


# ── Tests: /api/sui/status with NO manifest ───────────────────────────────

class TestSuiStatusNotDeployed:

    def test_sui_status_not_live(self, client):
        resp = client.get("/api/sui/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["live"] is False
        assert data["package_id"] is None

    def test_sui_registry_count_503_when_not_deployed(self, client):
        resp = client.get("/api/sui/registry/count")
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
