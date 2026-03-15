"""
Backend tests for Universal Privacy Layer - Chain and Token API testing
Tests: /api/health, /api/chains, /api/tokens/{chain}, /api/deployer-info, /api/stealth/generate
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealth:
    """Health check endpoint"""

    def test_health_returns_healthy(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print(f"PASS: /api/health → {data['status']}")

    def test_root_endpoint(self):
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "Universal Privacy Layer" in data.get("message", "")
        print(f"PASS: /api/ → {data}")


class TestChainsAPI:
    """Chain configuration endpoint - must return 4 live chains"""

    def test_chains_returns_200(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        assert response.status_code == 200
        print(f"PASS: /api/chains → 200")

    def test_chains_has_four_live_chains(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        live_chains = data.get("live_chains", [])
        assert len(live_chains) == 4, f"Expected 4 live chains, got {len(live_chains)}: {live_chains}"
        print(f"PASS: live_chains = {live_chains}")

    def test_chains_includes_base(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        assert "base" in data["chains"], "Base chain missing"
        base = data["chains"]["base"]
        assert base["chain_id"] == 8453
        assert base["symbol"] == "ETH"
        print(f"PASS: base chain present with chain_id=8453")

    def test_chains_includes_arbitrum(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        assert "arbitrum" in data["chains"], "Arbitrum chain missing"
        arb = data["chains"]["arbitrum"]
        assert arb["chain_id"] == 42161
        print(f"PASS: arbitrum chain present with chain_id=42161")

    def test_chains_includes_polygon(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        assert "polygon" in data["chains"], "Polygon chain missing"
        poly = data["chains"]["polygon"]
        assert poly["chain_id"] == 137
        print(f"PASS: polygon chain present with chain_id=137")

    def test_chains_includes_optimism(self):
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        assert "optimism" in data["chains"], "Optimism chain missing"
        opt = data["chains"]["optimism"]
        assert opt["chain_id"] == 10
        print(f"PASS: optimism chain present with chain_id=10")

    def test_contracts_privacy_relayer_address(self):
        """All 4 chains must have the correct PrivacyRelayer address"""
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        contracts = data.get("contracts", {})
        expected_relayer = "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        for chain in ["base", "arbitrum", "polygon", "optimism"]:
            assert chain in contracts, f"Contracts missing for {chain}"
            actual = contracts[chain].get("privacy_relayer")
            assert actual == expected_relayer, (
                f"{chain}: expected privacy_relayer={expected_relayer}, got {actual}"
            )
        print(f"PASS: All 4 chains have correct privacy_relayer={expected_relayer}")

    def test_contracts_stealth_registry_address(self):
        """All 4 chains must have the correct StealthRegistry address"""
        response = requests.get(f"{BASE_URL}/api/chains")
        data = response.json()
        contracts = data.get("contracts", {})
        expected_registry = "0xf2E7A6734E58774A8417c176AaE3898667699Ff4"
        for chain in ["base", "arbitrum", "polygon", "optimism"]:
            actual = contracts[chain].get("stealth_registry")
            assert actual == expected_registry, (
                f"{chain}: expected stealth_registry={expected_registry}, got {actual}"
            )
        print(f"PASS: All 4 chains have correct stealth_registry={expected_registry}")


class TestTokensAPI:
    """Token endpoints for all 4 live chains"""

    def test_tokens_base(self):
        response = requests.get(f"{BASE_URL}/api/tokens/base")
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "base"
        assert len(data["tokens"]) > 0
        symbols = list(data["tokens"].keys())
        assert "ETH" in symbols
        assert "USDC" in symbols
        print(f"PASS: /api/tokens/base → {symbols}")

    def test_tokens_arbitrum(self):
        response = requests.get(f"{BASE_URL}/api/tokens/arbitrum")
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "arbitrum"
        symbols = list(data["tokens"].keys())
        assert "ETH" in symbols
        assert "USDC" in symbols
        print(f"PASS: /api/tokens/arbitrum → {symbols}")

    def test_tokens_polygon(self):
        response = requests.get(f"{BASE_URL}/api/tokens/polygon")
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "polygon"
        symbols = list(data["tokens"].keys())
        assert "USDC" in symbols
        print(f"PASS: /api/tokens/polygon → {symbols}")

    def test_tokens_optimism(self):
        response = requests.get(f"{BASE_URL}/api/tokens/optimism")
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "optimism"
        symbols = list(data["tokens"].keys())
        assert "ETH" in symbols
        assert "USDC" in symbols
        print(f"PASS: /api/tokens/optimism → {symbols}")

    def test_tokens_invalid_chain_returns_400(self):
        response = requests.get(f"{BASE_URL}/api/tokens/solana")
        assert response.status_code == 400
        print(f"PASS: /api/tokens/solana → 400 (unsupported chain)")


class TestDeployerInfo:
    """Deployer info endpoint"""

    def test_deployer_info(self):
        response = requests.get(f"{BASE_URL}/api/deployer-info")
        assert response.status_code == 200
        data = response.json()
        assert "privacy_relayer" in data
        assert data["privacy_relayer"] == "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        assert set(data["deployed_on"]) == {"base", "arbitrum", "polygon", "optimism"}
        print(f"PASS: /api/deployer-info → deployed_on={data['deployed_on']}")


class TestStealthGenerate:
    """Stealth address generation"""

    def test_stealth_generate_success(self):
        payload = {
            "public_address": "0x1234567890abcdef1234567890abcdef12345678",
            "chain": "base"
        }
        response = requests.post(f"{BASE_URL}/api/stealth/generate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "stealth_address" in data
        assert data["stealth_address"].startswith("0x")
        assert "ephemeral_public_key" in data
        assert "view_tag" in data
        assert data["chain"] == "base"
        print(f"PASS: /api/stealth/generate → stealth={data['stealth_address'][:12]}...")

    def test_stealth_generate_for_arbitrum(self):
        payload = {
            "public_address": "0xabcdef1234567890abcdef1234567890abcdef12",
            "chain": "arbitrum"
        }
        response = requests.post(f"{BASE_URL}/api/stealth/generate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "arbitrum"
        print(f"PASS: /api/stealth/generate for arbitrum → {data['stealth_address'][:12]}...")
