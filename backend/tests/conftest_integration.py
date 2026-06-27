"""
Shared pytest fixtures for Universal Privacy Layer backend tests.
"""

import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "http://localhost:8001",
).rstrip("/")

ACCESS_CODE = os.environ.get("ACCESS_CODE", "")

TEST_OWNER_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # vitalik.eth


@pytest.fixture(scope="session")
def base_url():
    """Return the backend base URL."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL environment variable is required")
    return BASE_URL


@pytest.fixture(scope="session")
def access_code():
    """Return the access code for authentication."""
    if not ACCESS_CODE:
        pytest.skip("ACCESS_CODE environment variable is required")
    return ACCESS_CODE


@pytest.fixture(scope="session")
def auth_token(base_url, access_code):
    """Authenticate once per test session and return the bearer token."""
    response = requests.post(
        f"{base_url}/api/auth/verify-access",
        json={"code": access_code},
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 200, f"Auth failed: {response.text}"
    data = response.json()
    assert data.get("granted") is True
    assert "token" in data
    return data["token"]


@pytest.fixture
def test_entry_data():
    """Generate unique test address-book entry data."""
    import secrets

    return {
        "owner_address": TEST_OWNER_ADDRESS,
        "label": f"TEST_Contact_{secrets.token_hex(4)}",
        "stealth_meta_address": "st:eth:0x" + secrets.token_hex(66),
        "public_address": "0x" + secrets.token_hex(20),
        "notes_encrypted": "encrypted_notes_here",
        "chain": "base",
    }
