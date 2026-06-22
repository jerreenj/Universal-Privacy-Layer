"""
Backend API Tests for Universal Privacy Layer - 4 New Features
Wallet Privacy Analyzer, Privacy Address Book, ZK Commitments, Encrypted Receipts

Run with: pytest -v
"""

import secrets
import hashlib
from datetime import datetime
import pytest
import requests

from conftest import TEST_OWNER_ADDRESS


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _create_commitment_hash(amount_wei: str, blinding_factor: str) -> str:
    """SHA-256(amount_wei + blinding_factor)"""
    return hashlib.sha256((amount_wei + blinding_factor).encode()).hexdigest()


# ─── Authentication ────────────────────────────────────────────────────────

class TestAuth:
    """Authentication tests."""

    def test_auth_with_valid_code(self, base_url, access_code):
        """POST /api/auth/verify-access with valid code → 200 + token"""
        response = requests.post(
            f"{base_url}/api/auth/verify-access",
            json={"code": access_code},
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("granted") is True
        assert "token" in data
        assert "expires_in" in data

    def test_auth_with_invalid_code(self, base_url):
        """POST /api/auth/verify-access with invalid code → 401"""
        response = requests.post(
            f"{base_url}/api/auth/verify-access",
            json={"code": "wrong_code"},
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 401


# ─── Health & Basics ───────────────────────────────────────────────────────

class TestHealthAndBasics:
    """Basic health-check tests tests."""

    def test_health_endpoint(self, base_url):
        """GET /api/health → 200 healthy"""
        response = requests.get(f"{base_url}/api/health")
        assert response.status_code == 200
        assert response.json().get("status") == "healthy"


# ─── Wallet Privacy Analyzer ─────────────────────────────────────────────────

class TestWalletPrivacyAnalyzer:
    """Tests for GET /api/analyzer/scan/{address}"""

    def test_scan_known_address(self, base_url, auth_token):
        """Scanning vitalik.eth returns a complete privacy report."""
        response = requests.get(
            f"{base_url}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["address"] == TEST_OWNER_ADDRESS
        assert "privacy_score" in data and isinstance(data["privacy_score"], int)
        assert 0 <= data["privacy_score"] <= 100
        assert data["grade"] in {"A+", "A", "B", "C", "D", "F"}
        assert isinstance(data["chain_data"], dict)
        assert isinstance(data["risks"], list)
        assert isinstance(data["recommendations"], list)
        assert "total_tx_count" in data
        assert "chains_with_balance" in data
        assert "chains_with_activity" in data
        assert "scanned_at" in data

    def test_scan_returns_chain_data(self, base_url, auth_token):
        """Response contains expected L2/L1 chain entries."""
        response = requests.get(
            f"{base_url}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        data = response.json()
        expected = {"base", "arbitrum", "polygon", "optimism", "bnb", "avalanche"}
        for chain in expected:
            assert chain in data["chain_data"], f"missing chain: {chain}"
            info = data["chain_data"][chain]
            assert "balance_wei" in info and "tx_count" in info

    def test_scan_without_auth_fails(self, base_url):
        """Unauthenticated scan → 401."""
        response = requests.get(
            f"{base_url}/api/analyzer/scan/{TEST_OWNER_ADDRESS}"
        )
        assert response.status_code == 401


# ─── Privacy Address Book ───────────────────────────────────────────────────

class TestPrivacyAddressBook:
    """CRUD tests for /api/addressbook."""

    def test_add_contact(self, base_url, auth_token, test_entry_data):
        """POST /api/addressbook/add returns entry_id and label."""
        response = requests.post(
            f"{base_url}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "entry_id" in data
        assert data["label"] == test_entry_data["label"]

    def test_add_and_get_contacts(self, base_url, auth_token, test_entry_data):
        """After adding a contact we can retrieve it."""
        add = requests.post(
            f"{base_url}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        entry_id = add.json()["entry_id"]

        get = requests.get(
            f"{base_url}/api/addressbook/{test_entry_data['owner_address']}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert get.status_code == 200, get.text
        data = get.json()
        assert "entries" in data and "count" in data
        assert any(e.get("entry_id") == entry_id for e in data["entries"])

    def test_delete_contact(self, base_url, auth_token, test_entry_data):
        """Deleting a contact removes it from the list."""
        entry_id = requests.post(
            f"{base_url}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"},
        ).json()["entry_id"]

        delete = requests.delete(
            f"{base_url}/api/addressbook/{entry_id}",
            json={"owner_address": test_entry_data["owner_address"]},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert delete.status_code == 200
        data = delete.json()
        assert data.get("deleted") is True
        assert data.get("entry_id") == entry_id

        # verify removal
        get = requests.get(
            f"{base_url}/api/addressbook/{test_entry_data['owner_address']}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert not any(e.get("entry_id") == entry_id for e in get.json().get("entries", []))

    def test_delete_nonexistent_contact(self, base_url, auth_token):
        """DELETE on a missing ID → 404."""
        response = requests.delete(
            f"{base_url}/api/addressbook/nonexistent-id-12345",
            json={"owner_address": TEST_OWNER_ADDRESS},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 404

    def test_get_empty_addressbook(self, base_url, auth_token):
        """Querying an address with no contacts returns empty list."""
        random_address = "0x" + secrets.token_hex(20)
        response = requests.get(
            f"{base_url}/api/addressbook/{random_address}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["entries"] == []


# ─── ZK Commitments ──────────────────────────────────────────────────────────

class TestZKCommitments:
    """Tests for /api/zk-commitments."""

    @pytest.fixture
    def _sample_commitment(self, base_url, auth_token):
        """Return (commitment_id, amount_wei, blinding_factor, commitment_hash)."""
        amount_wei = "1000000000000000000"
        blinding_factor = secrets.token_hex(32)
        commitment_hash = _create_commitment_hash(amount_wei, blinding_factor)

        response = requests.post(
            f"{base_url}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "base",
                "label": "TEST_Commitment",
            },
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 200
        return response.json()["commitment_id"], amount_wei, blinding_factor, commitment_hash

    def test_create_commitment(self, base_url, auth_token, _sample_commitment):
        cid, amount, blinding, chash = _sample_commitment
        # creation already validated by fixture; just sanity-check the ID
        assert cid  # non-empty

    def test_get_commitments(self, base_url, auth_token, _sample_commitment):
        commitment_id, *_ = _sample_commitment

        get = requests.get(
            f"{base_url}/api/zk-commitments/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert get.status_code == 200, get.text
        data = get.json()
        assert "commitments" in data and "count" in data
        assert any(c.get("commitment_id") == commitment_id for c in data["commitments"])

    def test_verify_commitment_valid(self, base_url, auth_token, _sample_commitment):
        commitment_id, amount_wei, blinding_factor, commitment_hash = _sample_commitment
        verify = requests.post(
            f"{base_url}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": blinding_factor,
            },
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert verify.status_code == 200, verify.text
        data = verify.json()
        assert data["is_valid"] is True
        assert data["recomputed_hash"] == commitment_hash
        assert data["stored_hash"] == commitment_hash

    def test_verify_commitment_invalid(self, base_url, auth_token, _sample_commitment):
        commitment_id, amount_wei, _, _ = _sample_commitment
        verify = requests.post(
            f"{base_url}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": "wrong_blinding_factor",
            },
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        data = verify.json()
        assert data["is_valid"] is False
        assert data["recomputed_hash"] != data["stored_hash"]

    def test_verify_nonexistent_commitment(self, base_url, auth_token):
        response = requests.post(
            f"{base_url}/api/zk-commitments/verify",
            json={
                "commitment_id": "nonexistent-id-12345",
                "amount_wei": "1000000000000000000",
                "blinding_factor": "test",
            },
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 404


# ─── Encrypted Receipts ────────────────────────────────────────────────────

class TestEncryptedReceipts:
    """Tests for /api/receipt."""

    @staticmethod
    def _receipt_payload(**overrides):
        defaults = {
            "transaction_hash": "0x" + secrets.token_hex(32),
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "1000000000000000000",
            "chain": "base",
            "timestamp": datetime.utcnow().isoformat(),
        }
        defaults.update(overrides)
        return defaults

    def test_create_receipt(self, base_url, auth_token):
        response = requests.post(
            f"{base_url}/api/receipt/create",
            json=self._receipt_payload(),
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert "receipt_id" in data
        assert "encrypted_data" in data and len(data["encrypted_data"]) > 0
        assert "one_time_code" in data and len(data["one_time_code"]) == 32
        assert "created_at" in data

    def test_create_and_decrypt_receipt(self, base_url, auth_token):
        tx_hash = "0x" + secrets.token_hex(32)
        payload = self._receipt_payload(
            transaction_hash=tx_hash,
            amount_wei="2500000000000000000",
            chain="arbitrum",
        )

        created = requests.post(
            f"{base_url}/api/receipt/create",
            json=payload,
            headers={"Authorization": f"Bearer {auth_token}"},
        ).json()
        receipt_id = created["receipt_id"]
        one_time_code = created["one_time_code"]

        decrypt = requests.post(
            f"{base_url}/api/receipt/decrypt",
            json={"receipt_id": receipt_id, "one_time_code": one_time_code},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert decrypt.status_code == 200, decrypt.text
        receipt = decrypt.json()["receipt"]
        assert receipt["transaction_hash"] == tx_hash
        assert receipt["sender"] == payload["sender_address"]
        assert receipt["amount_wei"] == payload["amount_wei"]
        assert receipt["chain"] == payload["chain"]

    def test_decrypt_with_wrong_code(self, base_url, auth_token):
        created = requests.post(
            f"{base_url}/api/receipt/create",
            json=self._receipt_payload(chain="polygon"),
            headers={"Authorization": f"Bearer {auth_token}"},
        ).json()
        response = requests.post(
            f"{base_url}/api/receipt/decrypt",
            json={"receipt_id": created["receipt_id"], "one_time_code": "wrong_code_here"},
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 401

    def test_decrypt_nonexistent_receipt(self, base_url, auth_token):
        response = requests.post(
            f"{base_url}/api/receipt/decrypt",
            json={
                "receipt_id": "nonexistent-receipt-id",
                "one_time_code": "doesnt_matter",
            },
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert response.status_code == 404


# ─── Auth Protection ─────────────────────────────────────────────────────────

class TestAPIWithoutAuth:
    """Ensure protected endpoints reject unauthenticated requests."""

    def test_analyzer_requires_auth(self, base_url):
        assert requests.get(
            f"{base_url}/api/analyzer/scan/{TEST_OWNER_ADDRESS}"
        ).status_code == 401

    def test_addressbook_requires_auth(self, base_url):
        assert requests.post(
            f"{base_url}/api/addressbook/add",
            json={"owner_address": TEST_OWNER_ADDRESS, "label": "test"},
        ).status_code == 401
        assert requests.get(
            f"{base_url}/api/addressbook/{TEST_OWNER_ADDRESS}"
        ).status_code == 401

    def test_zk_commitments_requires_auth(self, base_url):
        assert requests.post(
            f"{base_url}/api/zk-commitments/create",
            json={"owner_address": TEST_OWNER_ADDRESS, "commitment_hash": "test", "amount_range": "1-10 ETH"},
        ).status_code == 401
        assert requests.get(
            f"{base_url}/api/zk-commitments/{TEST_OWNER_ADDRESS}"
        ).status_code == 401

    def test_receipts_requires_auth(self, base_url):
        assert requests.post(
            f"{base_url}/api/receipt/create",
            json={
                "transaction_hash": "0x123",
                "sender_address": TEST_OWNER_ADDRESS,
                "recipient_stealth_address": "0x456",
                "amount_wei": "1000",
                "chain": "base",
                "timestamp": "2024-01-01T00:00:00Z",
            },
        ).status_code == 401
        assert requests.post(
            f"{base_url}/api/receipt/decrypt",
            json={"receipt_id": "test", "one_time_code": "test"},
        ).status_code == 401