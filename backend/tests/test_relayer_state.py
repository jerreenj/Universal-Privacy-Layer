"""
Unit tests for /api/relayer/state endpoint.

Tests the relayer state endpoint which returns wallet address, tx count,
rotations, and rotation threshold info.
"""

import pytest
from unittest.mock import patch


@pytest.fixture(autouse=True)
def reset_relayer_state():
    """Reset relayer state before each test to ensure isolation."""
    import server as server_module
    original_state = server_module._current_relayer_state.copy()
    yield
    # Restore original state after test
    server_module._current_relayer_state.clear()
    server_module._current_relayer_state.update(original_state)


class TestRelayerState:
    """GET /api/relayer/state"""

    def test_relayer_state_returns_200(self, client):
        """Endpoint is public and returns 200."""
        resp = client.get("/api/relayer/state")
        assert resp.status_code == 200

    def test_relayer_state_response_structure(self, client):
        """Response has all required fields."""
        resp = client.get("/api/relayer/state")
        data = resp.json()
        
        assert "current_relayer_address" in data
        assert "tx_count" in data
        assert "rotations" in data
        assert "rotation_threshold" in data
        assert "tx_until_rotation" in data

    def test_relayer_state_default_values(self, client):
        """Returns sensible defaults when state is empty."""
        import server as server_module
        # Clear state to test defaults
        server_module._current_relayer_state.clear()
        
        resp = client.get("/api/relayer/state")
        data = resp.json()
        
        assert data["tx_count"] == 0
        assert data["rotations"] == 0
        assert data["rotation_threshold"] > 0
        assert data["tx_until_rotation"] == data["rotation_threshold"]

    def test_relayer_state_no_auth_required(self, client):
        """Endpoint is public — no Authorization header needed."""
        resp = client.get("/api/relayer/state")
        assert resp.status_code != 401

    def test_relayer_state_with_env_key(self, client):
        """Falls back to RELAYER_PRIVATE_KEY env var when state is empty."""
        test_private_key = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b2d"
        
        import server as server_module
        server_module._current_relayer_state.clear()
        
        with patch.dict("os.environ", {"RELAYER_PRIVATE_KEY": test_private_key}):
            resp = client.get("/api/relayer/state")
            data = resp.json()
            
            # Should derive address from the private key
            assert data["current_relayer_address"] is not None
            assert data["current_relayer_address"].startswith("0x")
            assert len(data["current_relayer_address"]) == 42

    def test_relayer_state_with_existing_state(self, client, _fake_db, reset_relayer_state):
        """Returns address from existing state when available."""
        import server as server_module
        
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
        server_module._current_relayer_state.update({
            "address": test_address,
            "tx_count": 150,
            "rotations": 2,
        })
        
        resp = client.get("/api/relayer/state")
        data = resp.json()
        
        assert data["current_relayer_address"] == test_address
        assert data["tx_count"] == 150
        assert data["rotations"] == 2

    def test_relayer_state_tx_until_rotation_calculation(self, client, reset_relayer_state):
        """tx_until_rotation is calculated correctly."""
        import server as server_module
        
        server_module._current_relayer_state.update({
            "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
            "tx_count": 75,
            "rotations": 0,
        })
        
        resp = client.get("/api/relayer/state")
        data = resp.json()
        
        expected = server_module.RELAYER_ROTATION_THRESHOLD - 75
        assert data["tx_until_rotation"] == expected
        assert data["tx_until_rotation"] >= 0

    def test_relayer_state_tx_until_rotation_never_negative(self, client, reset_relayer_state):
        """tx_until_rotation is never negative, even if tx_count exceeds threshold."""
        import server as server_module
        
        # Set tx_count higher than threshold
        server_module._current_relayer_state.update({
            "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
            "tx_count": server_module.RELAYER_ROTATION_THRESHOLD + 100,
            "rotations": 5,
        })
        
        resp = client.get("/api/relayer/state")
        data = resp.json()
        
        assert data["tx_until_rotation"] == 0
        assert data["tx_until_rotation"] >= 0

    def test_relayer_state_no_key_returns_null_address(self, client):
        """Returns null address when no key source is available."""
        import server as server_module
        
        # Clear state and ensure no env vars
        server_module._current_relayer_state.clear()
        
        with patch.dict("os.environ", {}, clear=True):
            with patch.object(server_module, "_read_hot_wallet_keyfile", return_value=None):
                resp = client.get("/api/relayer/state")
                data = resp.json()
                
                assert data["current_relayer_address"] is None
                # Other fields should still have defaults
                assert data["tx_count"] == 0
                assert data["rotations"] == 0

    def test_relayer_state_fallback_key_priority(self, client):
        """Falls back through key sources in correct priority order."""
        import server as server_module
        from eth_account import Account
        
        # Generate three different keys
        key1 = Account.create().key.hex()
        key2 = Account.create().key.hex()
        key3 = Account.create().key.hex()
        
        addr1 = Account.from_key(key1).address
        addr2 = Account.from_key(key2).address
        addr3 = Account.from_key(key3).address
        
        # Clear state
        server_module._current_relayer_state.clear()
        
        # Test priority: RELAYER_PRIVATE_KEY > hot wallet > DEPLOYER_PRIVATE_KEY
        with patch.dict("os.environ", {
            "RELAYER_PRIVATE_KEY": key1,
            "DEPLOYER_PRIVATE_KEY": key3,
        }):
            with patch.object(server_module, "_read_hot_wallet_keyfile", return_value=key2):
                resp = client.get("/api/relayer/state")
                data = resp.json()
                
                # Should use RELAYER_PRIVATE_KEY (highest priority)
                assert data["current_relayer_address"] == addr1
        
        # Test second priority: hot wallet when RELAYER_PRIVATE_KEY not set
        with patch.dict("os.environ", {"DEPLOYER_PRIVATE_KEY": key3}, clear=True):
            with patch.object(server_module, "_read_hot_wallet_keyfile", return_value=key2):
                resp = client.get("/api/relayer/state")
                data = resp.json()
                
                # Should use hot wallet (second priority)
                assert data["current_relayer_address"] == addr2
        
        # Test third priority: DEPLOYER_PRIVATE_KEY when others not set
        with patch.dict("os.environ", {"DEPLOYER_PRIVATE_KEY": key3}, clear=True):
            with patch.object(server_module, "_read_hot_wallet_keyfile", return_value=None):
                resp = client.get("/api/relayer/state")
                data = resp.json()
                
                # Should use DEPLOYER_PRIVATE_KEY (third priority)
                assert data["current_relayer_address"] == addr3
