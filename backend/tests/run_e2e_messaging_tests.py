#!/usr/bin/env python3
"""
Direct API Tests for E2E Encrypted Messaging Feature
Tests: register-key, pubkey lookup, send-e2e, inbox, legacy send
"""
import requests
import uuid
import sys

BASE_URL = "https://crypto-shield-24.preview.emergentagent.com"

# Test credentials
ACCESS_CODE = "ROTATED-ACCESS-CODE"
FOUNDER_TOKEN = "ae77cc286ceac8639d06f4dcda7eb5e341e5f92b4755419df1fa2e23e5b09c42"

# Test public key (compressed secp256k1 format - 66 hex chars)
TEST_PUBLIC_KEY = "02" + "a" * 64  # 66 chars compressed pubkey
TEST_UNREGISTERED_ADDRESS = "0x9999999999999999999999999999999999999999"

results = {"passed": 0, "failed": 0, "tests": []}

def log_result(test_name, passed, message=""):
    status = "PASS" if passed else "FAIL"
    results["tests"].append({"name": test_name, "status": status, "message": message})
    if passed:
        results["passed"] += 1
        print(f"✓ {test_name}: {message}")
    else:
        results["failed"] += 1
        print(f"✗ {test_name}: {message}")

def get_auth_token():
    """Get a valid auth token"""
    response = requests.post(
        f"{BASE_URL}/api/auth/verify-access",
        json={"code": ACCESS_CODE}
    )
    if response.status_code == 200:
        return response.json()["token"]
    return None

# ============ TESTS ============

def test_health():
    """GET /api/health returns 200"""
    response = requests.get(f"{BASE_URL}/api/health")
    passed = response.status_code == 200 and response.json().get("status") == "healthy"
    log_result("Health endpoint", passed, f"status={response.status_code}")

def test_access_gate_correct_code():
    """POST /api/auth/verify-access with 'ROTATED-ACCESS-CODE' returns token"""
    response = requests.post(
        f"{BASE_URL}/api/auth/verify-access",
        json={"code": ACCESS_CODE}
    )
    passed = response.status_code == 200 and response.json().get("granted") == True
    log_result("Access Gate - correct code", passed, f"status={response.status_code}")

def test_access_gate_wrong_code():
    """POST /api/auth/verify-access with wrong code returns 401"""
    response = requests.post(
        f"{BASE_URL}/api/auth/verify-access",
        json={"code": "WrongCode"}
    )
    passed = response.status_code == 401
    log_result("Access Gate - wrong code rejected", passed, f"status={response.status_code}")

def test_stats_requires_auth():
    """GET /api/stats without token returns 401"""
    response = requests.get(f"{BASE_URL}/api/stats")
    passed = response.status_code == 401
    log_result("Stats requires auth", passed, f"status={response.status_code}")

def test_stats_with_auth(token):
    """GET /api/stats with valid token returns 200"""
    response = requests.get(
        f"{BASE_URL}/api/stats",
        headers={"Authorization": f"Bearer {token}"}
    )
    passed = response.status_code == 200
    log_result("Stats with auth", passed, f"status={response.status_code}")

def test_register_key(token):
    """POST /api/messaging/register-key with valid data returns {registered: true}"""
    unique_address = f"0x{uuid.uuid4().hex[:40]}"
    response = requests.post(
        f"{BASE_URL}/api/messaging/register-key",
        json={
            "address": unique_address,
            "public_key": TEST_PUBLIC_KEY
        },
        headers={"Authorization": f"Bearer {token}"}
    )
    passed = response.status_code == 200 and response.json().get("registered") == True
    log_result("Register messaging key", passed, f"status={response.status_code}, data={response.json()}")
    return unique_address if passed else None

def test_pubkey_lookup_registered(token, registered_address):
    """GET /api/messaging/pubkey/{address} returns public_key for registered address"""
    response = requests.get(
        f"{BASE_URL}/api/messaging/pubkey/{registered_address}",
        headers={"Authorization": f"Bearer {token}"}
    )
    passed = response.status_code == 200 and "public_key" in response.json()
    log_result("Pubkey lookup - registered address", passed, f"status={response.status_code}")

def test_pubkey_lookup_unregistered(token):
    """GET /api/messaging/pubkey/{unregistered_address} returns 404"""
    response = requests.get(
        f"{BASE_URL}/api/messaging/pubkey/{TEST_UNREGISTERED_ADDRESS}",
        headers={"Authorization": f"Bearer {token}"}
    )
    passed = response.status_code == 404
    log_result("Pubkey lookup - unregistered returns 404", passed, f"status={response.status_code}")

def test_send_e2e(token):
    """POST /api/messaging/send-e2e returns {message_id, e2e: true}"""
    sender = f"0x{uuid.uuid4().hex[:40]}"
    recipient = f"0x{uuid.uuid4().hex[:40]}"
    
    response = requests.post(
        f"{BASE_URL}/api/messaging/send-e2e",
        json={
            "sender_address": sender,
            "recipient_address": recipient,
            "ciphertext": "abcdef1234567890",
            "ephemeral_pub": "02" + "c" * 64,
            "nonce": "aabbccdd11223344"
        },
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    passed = response.status_code == 200 and data.get("e2e") == True and "message_id" in data
    log_result("Send E2E message", passed, f"status={response.status_code}, e2e={data.get('e2e')}")
    return recipient if passed else None

def test_inbox_returns_e2e_messages(token, recipient):
    """GET /api/messaging/inbox/{address} returns messages with e2e=true"""
    response = requests.get(
        f"{BASE_URL}/api/messaging/inbox/{recipient}",
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    messages = data.get("messages", [])
    has_e2e = any(m.get("e2e") == True for m in messages)
    passed = response.status_code == 200 and has_e2e
    log_result("Inbox returns E2E messages", passed, f"status={response.status_code}, msg_count={len(messages)}, has_e2e={has_e2e}")

def test_inbox_empty_for_new_address(token):
    """GET /api/messaging/inbox/{new_address} returns empty list"""
    new_address = f"0x{uuid.uuid4().hex[:40]}"
    response = requests.get(
        f"{BASE_URL}/api/messaging/inbox/{new_address}",
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    passed = response.status_code == 200 and data.get("total_count", -1) == 0
    log_result("Inbox empty for new address", passed, f"status={response.status_code}")

def test_legacy_send(token):
    """POST /api/messaging/send still works for backward compatibility"""
    sender = f"0x{uuid.uuid4().hex[:40]}"
    recipient = f"0x{uuid.uuid4().hex[:40]}"
    
    response = requests.post(
        f"{BASE_URL}/api/messaging/send",
        json={
            "sender_address": sender,
            "recipient_address": recipient,
            "message": "Hello, this is a test message",
            "recipient_public_key": recipient
        },
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    passed = response.status_code == 200 and "message_id" in data and "encrypted_content" in data
    log_result("Legacy send (backward compat)", passed, f"status={response.status_code}")
    return recipient if passed else None

def test_legacy_message_in_inbox(token, recipient):
    """Legacy messages appear in inbox with e2e=false"""
    response = requests.get(
        f"{BASE_URL}/api/messaging/inbox/{recipient}",
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    messages = data.get("messages", [])
    has_legacy = any(m.get("e2e") == False for m in messages)
    passed = response.status_code == 200 and has_legacy
    log_result("Legacy messages in inbox with e2e=false", passed, f"status={response.status_code}, has_legacy={has_legacy}")

def test_register_key_updates_existing(token):
    """POST /api/messaging/register-key updates existing key (upsert)"""
    unique_address = f"0x{uuid.uuid4().hex[:40]}"
    new_pubkey = "03" + "b" * 64
    
    # First registration
    requests.post(
        f"{BASE_URL}/api/messaging/register-key",
        json={"address": unique_address, "public_key": TEST_PUBLIC_KEY},
        headers={"Authorization": f"Bearer {token}"}
    )
    
    # Update with new key
    requests.post(
        f"{BASE_URL}/api/messaging/register-key",
        json={"address": unique_address, "public_key": new_pubkey},
        headers={"Authorization": f"Bearer {token}"}
    )
    
    # Verify the key was updated
    response = requests.get(
        f"{BASE_URL}/api/messaging/pubkey/{unique_address}",
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json() if response.status_code == 200 else {}
    passed = response.status_code == 200 and data.get("public_key") == new_pubkey
    log_result("Register key updates existing", passed, f"status={response.status_code}")

def main():
    print("=" * 60)
    print("E2E ENCRYPTED MESSAGING API TESTS")
    print("=" * 60)
    print(f"Base URL: {BASE_URL}")
    print()
    
    # Get auth token first
    print("Getting auth token...")
    token = get_auth_token()
    if not token:
        print("FATAL: Could not get auth token")
        sys.exit(1)
    print(f"Auth token obtained: {token[:16]}...")
    print()
    
    # Run tests
    print("-" * 60)
    print("CORE TESTS")
    print("-" * 60)
    
    test_health()
    test_access_gate_correct_code()
    test_access_gate_wrong_code()
    test_stats_requires_auth()
    test_stats_with_auth(token)
    
    print()
    print("-" * 60)
    print("E2E MESSAGING TESTS")
    print("-" * 60)
    
    # Register key tests
    registered_address = test_register_key(token)
    if registered_address:
        test_pubkey_lookup_registered(token, registered_address)
    test_pubkey_lookup_unregistered(token)
    test_register_key_updates_existing(token)
    
    # Send E2E tests
    e2e_recipient = test_send_e2e(token)
    if e2e_recipient:
        test_inbox_returns_e2e_messages(token, e2e_recipient)
    test_inbox_empty_for_new_address(token)
    
    # Legacy tests
    legacy_recipient = test_legacy_send(token)
    if legacy_recipient:
        test_legacy_message_in_inbox(token, legacy_recipient)
    
    # Summary
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Passed: {results['passed']}")
    print(f"Failed: {results['failed']}")
    print(f"Total:  {results['passed'] + results['failed']}")
    print(f"Success Rate: {results['passed'] / (results['passed'] + results['failed']) * 100:.1f}%")
    
    if results['failed'] > 0:
        print()
        print("FAILED TESTS:")
        for t in results['tests']:
            if t['status'] == 'FAIL':
                print(f"  - {t['name']}: {t['message']}")
    
    return results['failed'] == 0

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
