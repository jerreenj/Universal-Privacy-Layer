"""
Unit tests for /api/health and /api/auth/verify-access.
No live MongoDB required — uses FakeDatabase from conftest_unit.
"""

import pytest

# Fixtures (client, auth_token, _fake_db) come from conftest_unit.py
# which pytest auto-discovers as a conftest in the tests/ directory.
# No explicit import needed — pytest picks it up by name.


class TestHealth:
    """GET /api/health"""

    def test_health_returns_200(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data

    def test_health_no_auth_required(self, client):
        """Health endpoint is public — no Authorization header needed."""
        resp = client.get("/api/health")
        assert resp.status_code != 401


class TestVerifyAccess:
    """POST /api/auth/verify-access"""

    def test_valid_code_returns_token(self, client):
        resp = client.post(
            "/api/auth/verify-access",
            json={"code": "test-access-code-123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["granted"] is True
        assert "token" in data
        assert isinstance(data["token"], str)
        assert len(data["token"]) > 10

    def test_invalid_code_returns_401(self, client):
        resp = client.post(
            "/api/auth/verify-access",
            json={"code": "wrong-code"},
        )
        assert resp.status_code == 401
        assert "Invalid access code" in resp.json()["detail"]

    def test_missing_code_returns_422(self, client):
        """Body without 'code' field → FastAPI validation error."""
        resp = client.post(
            "/api/auth/verify-access",
            json={},
        )
        assert resp.status_code == 422

    def test_token_works_for_protected_route(self, client, auth_token):
        """Token issued by verify-access should grant access to protected routes."""
        resp = client.get(
            "/api/chains",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert resp.status_code == 200

    def test_invalid_token_rejected(self, client):
        """A garbage token should get 401 on protected routes."""
        resp = client.get(
            "/api/chains",
            headers={"Authorization": "Bearer deadbeef00"},
        )
        assert resp.status_code == 401

    def test_no_auth_header_rejected(self, client):
        """Missing Authorization header → 401 on protected routes."""
        resp = client.get("/api/chains")
        assert resp.status_code == 401


class TestRoot:
    """GET /api/"""

    def test_root_returns_info(self, client):
        resp = client.get("/api/")
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert "version" in data
