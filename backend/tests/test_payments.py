"""
Unit tests for /api/payments/info and /api/payments/submit.
No live MongoDB required — uses FakeDatabase from conftest_unit.
"""

import pytest

# Fixtures come from conftest_unit.py — pytest auto-discovers it.


class TestPaymentInfo:
    """GET /api/payments/info"""

    def test_info_returns_200(self, client):
        resp = client.get("/api/payments/info")
        assert resp.status_code == 200
        data = resp.json()
        assert "enabled" in data
        assert "wallet" in data
        assert "accepted_tokens" in data

    def test_info_no_auth_required(self, client):
        """Payments info is a public endpoint."""
        resp = client.get("/api/payments/info")
        assert resp.status_code != 401

    def test_info_shows_wallet_when_configured(self, client):
        resp = client.get("/api/payments/info")
        data = resp.json()
        # PAYOUT_WALLET is set to a real address in conftest_unit
        assert data["enabled"] is True
        assert data["wallet"].startswith("0x")
        assert len(data["wallet"]) == 42

    def test_info_lists_accepted_tokens(self, client):
        resp = client.get("/api/payments/info")
        data = resp.json()
        tokens = data["accepted_tokens"]
        assert isinstance(tokens, list)
        assert len(tokens) > 0
        symbols = [t["symbol"] for t in tokens]
        assert "ETH" in symbols
        assert "USDC" in symbols


class TestSubmitPayment:
    """POST /api/payments/submit"""

    def _valid_payload(self, **overrides):
        base = {
            "tx_hash": "0x" + "ab" * 32,
            "amount_usd": 99.0,
            "chain": "base",
            "token": "ETH",
            "sender_address": "0x" + "cc" * 20,
            "email": "buyer@example.com",
        }
        base.update(overrides)
        return base

    def test_submit_returns_200(self, client):
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "submitted"
        assert "message" in data

    def test_submit_no_auth_required(self, client):
        """Payments submit is a public endpoint."""
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(),
        )
        assert resp.status_code != 401

    def test_submit_short_tx_hash_rejected(self, client):
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(tx_hash="0xabc"),
        )
        assert resp.status_code == 400
        assert "Invalid transaction hash" in resp.json()["detail"]

    def test_submit_empty_tx_hash_rejected(self, client):
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(tx_hash=""),
        )
        assert resp.status_code == 400

    def test_submit_invalid_email_rejected(self, client):
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(email="not-an-email"),
        )
        assert resp.status_code == 400
        assert "Invalid email" in resp.json()["detail"]

    def test_submit_valid_email_optional(self, client):
        """Email is optional — should succeed without it."""
        resp = client.post(
            "/api/payments/submit",
            json=self._valid_payload(email=""),
        )
        assert resp.status_code == 200

    def test_submit_duplicate_tx_hash_rejected(self, client):
        """Same tx_hash submitted twice → 409 Conflict."""
        payload = self._valid_payload()
        resp1 = client.post("/api/payments/submit", json=payload)
        assert resp1.status_code == 200

        resp2 = client.post("/api/payments/submit", json=payload)
        assert resp2.status_code == 409
        assert "already submitted" in resp2.json()["detail"]

    def test_submit_different_tx_hashes_both_succeed(self, client):
        """Two different tx_hashes should both succeed."""
        resp1 = client.post(
            "/api/payments/submit",
            json=self._valid_payload(tx_hash="0x" + "aa" * 32),
        )
        assert resp1.status_code == 200

        resp2 = client.post(
            "/api/payments/submit",
            json=self._valid_payload(tx_hash="0x" + "bb" * 32),
        )
        assert resp2.status_code == 200
