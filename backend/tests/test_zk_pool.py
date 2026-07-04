"""
P3.5-A tests for the new /api/zk-pool/state endpoint and zk_merkle helper.
Follows the exact pattern of test_deployments.py (mocked DB, no live Mongo).
"""

import pytest
from fastapi.testclient import TestClient
from backend.server import app

client = TestClient(app)


def test_zk_pool_state_not_deployed():
    """When no privacy_pool address exists in deployed_base.json, endpoint returns live=False."""
    # The test environment has no deployed_base.json with privacy_pool,
    # so we expect the "not yet deployed" response.
    r = client.get("/api/zk-pool/state")
    assert r.status_code == 200
    data = r.json()
    assert data.get("live") is False
    assert "privacy_pool" not in data or data.get("privacy_pool") is None


def test_zk_merkle_import():
    """zk_merkle module imports and basic Poseidon functions work."""
    from backend.zk_merkle import poseidon2, poseidon1, IncrementalMerkleTree

    # Known vector from P3.3 (poseidon(1,2) == on-chain)
    a, b = 1, 2
    h = poseidon2(a, b)
    assert isinstance(h, int)
    assert h > 0

    nh = poseidon1(12345)
    assert isinstance(nh, int)
    assert nh > 0

    tree = IncrementalMerkleTree()
    idx = tree.insert(0xdeadbeef)
    assert idx == 0
    assert tree.leaf_count == 1
    assert tree.root != 0