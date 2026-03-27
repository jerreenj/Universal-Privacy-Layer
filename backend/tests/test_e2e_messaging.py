"""
Backend API Tests for E2E Encrypted Messaging Feature
Tests: register-key, pubkey lookup, send-e2e, inbox, legacy send
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ACCESS_CODE = "ROTATED-ACCESS-CODE"
FOUNDER_TOKEN = "ae77cc286ceac8639d06f4dcda7eb5e341e5f92b4755419df1fa2e23e5b09c42"

# Test wallet addresses (valid EVM format)
TEST_SENDER_ADDRESS = "0x1234567890123456789012345678901234567890"
TEST_RECIPIENT_ADDRESS = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12"
TEST_UNREGISTERED_ADDRESS = "0x9999999999999999999999999999999999999999"

# Test public key (compressed secp256k1 format - 66 hex chars)
TEST_PUBLIC_KEY = "02" + "a" * 64  # 66 chars compressed pubkey


@pytest.fixture(scope="module")
def auth_token():
    """Get a valid auth token for protected endpoints"""
    response = requests.post(
        f"{BASE_URL}/api/auth/verify-access",
        json={"code": ACCESS_CODE}
    )
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Could not get auth token")


class TestAccessGateStillWorks:
    """Verify Access Gate still works (backward compatibility)"""
    
    def test_verify_access_correct_code(self):
        """POST /api/auth/verify-access with 'ROTATED-ACCESS-CODE' returns token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["granted"] == True
        assert "token" in data
        assert len(data["token"]) > 0
        print(f"✓ Access Gate works: token={data['token'][:16]}...")
    
    def test_verify_access_wrong_code(self):
        """POST /api/auth/verify-access with wrong code returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": "WrongCode"}
        )
        assert response.status_code == 401
        print("✓ Wrong code rejected")


class TestStatsRequiresAuth:
    """Verify /api/stats still requires auth"""
    
    def test_stats_without_auth(self):
        """GET /api/stats without token returns 401"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 401
        print("✓ /api/stats requires auth")
    
    def test_stats_with_auth(self, auth_token):
        """GET /api/stats with valid token returns 200"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_transactions" in data or "live_chains" in data
        print(f"✓ /api/stats with auth: {list(data.keys())}")


class TestMessagingRegisterKey:
    """Tests for POST /api/messaging/register-key"""
    
    def test_register_key_success(self, auth_token):
        """POST /api/messaging/register-key with valid data returns {registered: true}"""
        unique_address = f"0x{uuid.uuid4().hex[:40]}"
        response = requests.post(
            f"{BASE_URL}/api/messaging/register-key",
            json={
                "address": unique_address,
                "public_key": TEST_PUBLIC_KEY
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["registered"] == True
        assert "address" in data
        print(f"✓ Register key success: {data}")
    
    def test_register_key_updates_existing(self, auth_token):
        """POST /api/messaging/register-key updates existing key (upsert)"""
        unique_address = f"0x{uuid.uuid4().hex[:40]}"
        new_pubkey = "03" + "b" * 64  # Different pubkey
        
        # First registration
        response1 = requests.post(
            f"{BASE_URL}/api/messaging/register-key",
            json={"address": unique_address, "public_key": TEST_PUBLIC_KEY},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response1.status_code == 200
        
        # Update with new key
        response2 = requests.post(
            f"{BASE_URL}/api/messaging/register-key",
            json={"address": unique_address, "public_key": new_pubkey},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response2.status_code == 200
        
        # Verify the key was updated
        response3 = requests.get(
            f"{BASE_URL}/api/messaging/pubkey/{unique_address}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response3.status_code == 200
        assert response3.json()["public_key"] == new_pubkey
        print("✓ Register key updates existing key")


class TestMessagingPubkeyLookup:
    """Tests for GET /api/messaging/pubkey/{address}"""
    
    def test_pubkey_lookup_registered_address(self, auth_token):
        """GET /api/messaging/pubkey/{address} returns public_key for registered address"""
        # First register a key
        unique_address = f"0x{uuid.uuid4().hex[:40]}"
        requests.post(
            f"{BASE_URL}/api/messaging/register-key",
            json={"address": unique_address, "public_key": TEST_PUBLIC_KEY},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Now lookup
        response = requests.get(
            f"{BASE_URL}/api/messaging/pubkey/{unique_address}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "public_key" in data
        assert data["public_key"] == TEST_PUBLIC_KEY
        print(f"✓ Pubkey lookup success: {data}")
    
    def test_pubkey_lookup_unregistered_address(self, auth_token):
        """GET /api/messaging/pubkey/{unregistered_address} returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/messaging/pubkey/{TEST_UNREGISTERED_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        print(f"✓ Unregistered address returns 404: {data['detail']}")
    
    def test_pubkey_lookup_case_insensitive(self, auth_token):
        """GET /api/messaging/pubkey/{address} is case-insensitive"""
        unique_address = f"0x{uuid.uuid4().hex[:40]}"
        
        # Register with lowercase
        requests.post(
            f"{BASE_URL}/api/messaging/register-key",
            json={"address": unique_address.lower(), "public_key": TEST_PUBLIC_KEY},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Lookup with uppercase
        response = requests.get(
            f"{BASE_URL}/api/messaging/pubkey/{unique_address.upper()}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        print("✓ Pubkey lookup is case-insensitive")


class TestMessagingSendE2E:
    """Tests for POST /api/messaging/send-e2e"""
    
    def test_send_e2e_success(self, auth_token):
        """POST /api/messaging/send-e2e returns {message_id, e2e: true}"""
        sender = f"0x{uuid.uuid4().hex[:40]}"
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        
        response = requests.post(
            f"{BASE_URL}/api/messaging/send-e2e",
            json={
                "sender_address": sender,
                "recipient_address": recipient,
                "ciphertext": "abcdef1234567890",  # Hex-encoded ciphertext
                "ephemeral_pub": "02" + "c" * 64,  # Ephemeral public key
                "nonce": "aabbccdd11223344"  # 12-byte nonce as hex
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message_id" in data
        assert data["e2e"] == True
        assert data["recipient"] == recipient
        print(f"✓ Send E2E success: message_id={data['message_id'][:8]}...")
    
    def test_send_e2e_with_tx_hash(self, auth_token):
        """POST /api/messaging/send-e2e with attached_tx_hash"""
        sender = f"0x{uuid.uuid4().hex[:40]}"
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        tx_hash = "0x" + "f" * 64
        
        response = requests.post(
            f"{BASE_URL}/api/messaging/send-e2e",
            json={
                "sender_address": sender,
                "recipient_address": recipient,
                "ciphertext": "encrypted_data_here",
                "ephemeral_pub": "02" + "d" * 64,
                "nonce": "112233445566",
                "attached_tx_hash": tx_hash
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["e2e"] == True
        print("✓ Send E2E with tx_hash success")


class TestMessagingInbox:
    """Tests for GET /api/messaging/inbox/{address}"""
    
    def test_inbox_returns_messages(self, auth_token):
        """GET /api/messaging/inbox/{address} returns messages with e2e=true for E2E messages"""
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        sender = f"0x{uuid.uuid4().hex[:40]}"
        
        # Send an E2E message first
        requests.post(
            f"{BASE_URL}/api/messaging/send-e2e",
            json={
                "sender_address": sender,
                "recipient_address": recipient,
                "ciphertext": "test_ciphertext",
                "ephemeral_pub": "02" + "e" * 64,
                "nonce": "aabbccdd1122"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Check inbox
        response = requests.get(
            f"{BASE_URL}/api/messaging/inbox/{recipient}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert len(data["messages"]) >= 1
        
        # Verify E2E message structure
        e2e_msg = next((m for m in data["messages"] if m.get("e2e") == True), None)
        assert e2e_msg is not None, "Should have at least one E2E message"
        assert "ciphertext" in e2e_msg
        assert "ephemeral_pub" in e2e_msg
        assert "nonce" in e2e_msg
        print(f"✓ Inbox returns E2E messages: {len(data['messages'])} messages")
    
    def test_inbox_empty_for_new_address(self, auth_token):
        """GET /api/messaging/inbox/{new_address} returns empty list"""
        new_address = f"0x{uuid.uuid4().hex[:40]}"
        
        response = requests.get(
            f"{BASE_URL}/api/messaging/inbox/{new_address}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert data["total_count"] == 0
        print("✓ Inbox empty for new address")
    
    def test_inbox_case_insensitive(self, auth_token):
        """GET /api/messaging/inbox/{address} is case-insensitive"""
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        sender = f"0x{uuid.uuid4().hex[:40]}"
        
        # Send message to lowercase address
        requests.post(
            f"{BASE_URL}/api/messaging/send-e2e",
            json={
                "sender_address": sender,
                "recipient_address": recipient.lower(),
                "ciphertext": "test",
                "ephemeral_pub": "02" + "f" * 64,
                "nonce": "112233"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Fetch with uppercase
        response = requests.get(
            f"{BASE_URL}/api/messaging/inbox/{recipient.upper()}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) >= 1
        print("✓ Inbox is case-insensitive")


class TestLegacyMessagingSend:
    """Tests for legacy POST /api/messaging/send (backward compatibility)"""
    
    def test_legacy_send_success(self, auth_token):
        """POST /api/messaging/send still works for backward compatibility"""
        sender = f"0x{uuid.uuid4().hex[:40]}"
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        
        response = requests.post(
            f"{BASE_URL}/api/messaging/send",
            json={
                "sender_address": sender,
                "recipient_address": recipient,
                "message": "Hello, this is a test message",
                "recipient_public_key": recipient  # Legacy uses address as key
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message_id" in data
        assert "encrypted_content" in data
        print(f"✓ Legacy send works: message_id={data['message_id'][:8]}...")
    
    def test_legacy_message_in_inbox(self, auth_token):
        """Legacy messages appear in inbox with e2e=false"""
        sender = f"0x{uuid.uuid4().hex[:40]}"
        recipient = f"0x{uuid.uuid4().hex[:40]}"
        
        # Send legacy message
        requests.post(
            f"{BASE_URL}/api/messaging/send",
            json={
                "sender_address": sender,
                "recipient_address": recipient,
                "message": "Legacy test message",
                "recipient_public_key": recipient
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Check inbox
        response = requests.get(
            f"{BASE_URL}/api/messaging/inbox/{recipient}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Find legacy message (e2e=false)
        legacy_msg = next((m for m in data["messages"] if m.get("e2e") == False), None)
        assert legacy_msg is not None, "Should have legacy message"
        assert "encrypted_content" in legacy_msg
        print("✓ Legacy messages appear in inbox with e2e=false")


class TestHealthEndpoint:
    """Verify health endpoint still works"""
    
    def test_health_returns_200(self):
        """GET /api/health returns 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"✓ Health check: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
