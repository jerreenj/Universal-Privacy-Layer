#!/usr/bin/env python3
"""
Backend API Tests for Universal Privacy Layer - 4 New Features
Standalone test script (no pytest dependency due to web3 plugin conflict)
- Wallet Privacy Analyzer
- Privacy Address Book
- ZK Commitments
- Encrypted Receipts
"""

import requests
import os
import hashlib
import secrets
import json
from datetime import datetime
import sys

# Get backend URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://stealth-shield-4.preview.emergentagent.com').rstrip('/')
ACCESS_CODE = os.environ.get('ACCESS_CODE', '')
if not ACCESS_CODE:
    raise RuntimeError("ACCESS_CODE environment variable is required (read from your password manager or .env)")

# Test wallet addresses
TEST_OWNER_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # vitalik.eth

# Test results tracking
results = {
    "passed": 0,
    "failed": 0,
    "tests": []
}

def log_result(test_name, passed, message=""):
    """Log test result"""
    status = "PASS" if passed else "FAIL"
    results["tests"].append({
        "name": test_name,
        "passed": passed,
        "message": message
    })
    if passed:
        results["passed"] += 1
        print(f"✓ {test_name}")
    else:
        results["failed"] += 1
        print(f"✗ {test_name}: {message}")

def get_auth_token():
    """Get authentication token"""
    response = requests.post(
        f"{BASE_URL}/api/auth/verify-access",
        json={"code": ACCESS_CODE},
        headers={"Content-Type": "application/json"}
    )
    if response.status_code == 200:
        return response.json().get("token")
    return None

def create_commitment_hash(amount_wei: str, blinding_factor: str) -> str:
    """Create commitment hash: SHA-256(amount_wei + blinding_factor)"""
    return hashlib.sha256((amount_wei + blinding_factor).encode()).hexdigest()


# ============== TEST FUNCTIONS ==============

def test_health():
    """Test health endpoint"""
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        passed = response.status_code == 200 and response.json().get("status") == "healthy"
        log_result("Health Check", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("Health Check", False, str(e))

def test_auth_valid():
    """Test authentication with valid code"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        data = response.json()
        passed = response.status_code == 200 and data.get("granted") == True and "token" in data
        log_result("Auth with valid code", passed, "" if passed else f"Response: {data}")
    except Exception as e:
        log_result("Auth with valid code", False, str(e))

def test_auth_invalid():
    """Test authentication with invalid code"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": "wrong_code"}
        )
        passed = response.status_code == 401
        log_result("Auth with invalid code rejected", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("Auth with invalid code rejected", False, str(e))


# ============== WALLET PRIVACY ANALYZER TESTS ==============

def test_analyzer_scan(token):
    """Test wallet privacy analyzer scan"""
    try:
        response = requests.get(
            f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if response.status_code != 200:
            log_result("Analyzer scan", False, f"Status: {response.status_code}, Response: {response.text}")
            return
        
        data = response.json()
        
        # Check required fields
        required_fields = ["address", "privacy_score", "grade", "chain_data", "risks", "recommendations", "total_tx_count", "chains_with_balance", "chains_with_activity", "scanned_at"]
        missing = [f for f in required_fields if f not in data]
        
        if missing:
            log_result("Analyzer scan", False, f"Missing fields: {missing}")
            return
        
        # Validate data types
        if not isinstance(data["privacy_score"], int) or not (0 <= data["privacy_score"] <= 100):
            log_result("Analyzer scan", False, f"Invalid privacy_score: {data['privacy_score']}")
            return
        
        if data["grade"] not in ["A+", "A", "B", "C", "D", "F"]:
            log_result("Analyzer scan", False, f"Invalid grade: {data['grade']}")
            return
        
        log_result("Analyzer scan", True)
        print(f"  - Privacy Score: {data['privacy_score']}, Grade: {data['grade']}")
        print(f"  - TX Count: {data['total_tx_count']}, Chains with activity: {data['chains_with_activity']}")
    except Exception as e:
        log_result("Analyzer scan", False, str(e))

def test_analyzer_chain_data(token):
    """Test analyzer returns all expected chains"""
    try:
        response = requests.get(
            f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {token}"}
        )
        data = response.json()
        
        expected_chains = ["base", "arbitrum", "polygon", "optimism", "bnb", "avalanche"]
        chain_data = data.get("chain_data", {})
        
        missing_chains = [c for c in expected_chains if c not in chain_data]
        if missing_chains:
            log_result("Analyzer chain data", False, f"Missing chains: {missing_chains}")
            return
        
        # Check each chain has required fields
        for chain in expected_chains:
            if "balance_wei" not in chain_data[chain] or "tx_count" not in chain_data[chain]:
                log_result("Analyzer chain data", False, f"Chain {chain} missing balance_wei or tx_count")
                return
        
        log_result("Analyzer chain data", True)
    except Exception as e:
        log_result("Analyzer chain data", False, str(e))

def test_analyzer_without_auth():
    """Test analyzer requires auth"""
    try:
        response = requests.get(f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}")
        passed = response.status_code == 401
        log_result("Analyzer requires auth", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("Analyzer requires auth", False, str(e))


# ============== ADDRESS BOOK TESTS ==============

def test_addressbook_add(token):
    """Test adding contact to address book"""
    try:
        entry_data = {
            "owner_address": TEST_OWNER_ADDRESS,
            "label": f"TEST_Contact_{secrets.token_hex(4)}",
            "stealth_meta_address": "st:eth:0x" + secrets.token_hex(66),
            "public_address": "0x" + secrets.token_hex(20),
            "notes_encrypted": "encrypted_notes_here",
            "chain": "base"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=entry_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code != 200:
            log_result("Address book add", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
        
        data = response.json()
        if "entry_id" not in data or "label" not in data:
            log_result("Address book add", False, f"Missing fields in response: {data}")
            return None
        
        log_result("Address book add", True)
        return data["entry_id"]
    except Exception as e:
        log_result("Address book add", False, str(e))
        return None

def test_addressbook_get(token):
    """Test getting address book entries"""
    try:
        # First add an entry
        entry_data = {
            "owner_address": TEST_OWNER_ADDRESS,
            "label": f"TEST_GetContact_{secrets.token_hex(4)}",
            "public_address": "0x" + secrets.token_hex(20),
            "chain": "arbitrum"
        }
        
        add_response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=entry_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if add_response.status_code != 200:
            log_result("Address book get", False, f"Failed to add entry: {add_response.text}")
            return
        
        entry_id = add_response.json()["entry_id"]
        
        # Get entries
        get_response = requests.get(
            f"{BASE_URL}/api/addressbook/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if get_response.status_code != 200:
            log_result("Address book get", False, f"Status: {get_response.status_code}")
            return
        
        data = get_response.json()
        if "entries" not in data or "count" not in data:
            log_result("Address book get", False, f"Missing fields: {data}")
            return
        
        # Find our entry
        found = any(e.get("entry_id") == entry_id for e in data["entries"])
        if not found:
            log_result("Address book get", False, f"Entry {entry_id} not found in list")
            return
        
        log_result("Address book get", True)
        print(f"  - Total entries: {data['count']}")
    except Exception as e:
        log_result("Address book get", False, str(e))

def test_addressbook_delete(token):
    """Test deleting address book entry"""
    try:
        # First add an entry
        entry_data = {
            "owner_address": TEST_OWNER_ADDRESS,
            "label": f"TEST_DeleteContact_{secrets.token_hex(4)}",
            "public_address": "0x" + secrets.token_hex(20),
            "chain": "polygon"
        }
        
        add_response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=entry_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        entry_id = add_response.json()["entry_id"]
        
        # Delete entry
        delete_response = requests.delete(
            f"{BASE_URL}/api/addressbook/{entry_id}",
            json={"owner_address": TEST_OWNER_ADDRESS},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if delete_response.status_code != 200:
            log_result("Address book delete", False, f"Status: {delete_response.status_code}")
            return
        
        data = delete_response.json()
        if data.get("deleted") != True or data.get("entry_id") != entry_id:
            log_result("Address book delete", False, f"Unexpected response: {data}")
            return
        
        # Verify deletion
        get_response = requests.get(
            f"{BASE_URL}/api/addressbook/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {token}"}
        )
        entries = get_response.json().get("entries", [])
        still_exists = any(e.get("entry_id") == entry_id for e in entries)
        
        if still_exists:
            log_result("Address book delete", False, "Entry still exists after deletion")
            return
        
        log_result("Address book delete", True)
    except Exception as e:
        log_result("Address book delete", False, str(e))

def test_addressbook_delete_nonexistent(token):
    """Test deleting non-existent entry returns 404"""
    try:
        response = requests.delete(
            f"{BASE_URL}/api/addressbook/nonexistent-id-12345",
            json={"owner_address": TEST_OWNER_ADDRESS},
            headers={"Authorization": f"Bearer {token}"}
        )
        passed = response.status_code == 404
        log_result("Address book delete nonexistent returns 404", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("Address book delete nonexistent returns 404", False, str(e))


# ============== ZK COMMITMENTS TESTS ==============

def test_zk_create_commitment(token):
    """Test creating ZK commitment"""
    try:
        amount_wei = "1000000000000000000"  # 1 ETH
        blinding_factor = secrets.token_hex(32)
        commitment_hash = create_commitment_hash(amount_wei, blinding_factor)
        
        response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "base",
                "label": "TEST_Commitment"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code != 200:
            log_result("ZK create commitment", False, f"Status: {response.status_code}, Response: {response.text}")
            return None, None, None
        
        data = response.json()
        if "commitment_id" not in data or data.get("commitment_hash") != commitment_hash:
            log_result("ZK create commitment", False, f"Invalid response: {data}")
            return None, None, None
        
        log_result("ZK create commitment", True)
        return data["commitment_id"], amount_wei, blinding_factor
    except Exception as e:
        log_result("ZK create commitment", False, str(e))
        return None, None, None

def test_zk_get_commitments(token):
    """Test getting ZK commitments"""
    try:
        # First create a commitment
        amount_wei = "2000000000000000000"
        blinding_factor = secrets.token_hex(32)
        commitment_hash = create_commitment_hash(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "arbitrum"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        commitment_id = create_response.json()["commitment_id"]
        
        # Get commitments
        get_response = requests.get(
            f"{BASE_URL}/api/zk-commitments/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if get_response.status_code != 200:
            log_result("ZK get commitments", False, f"Status: {get_response.status_code}")
            return
        
        data = get_response.json()
        if "commitments" not in data or "count" not in data:
            log_result("ZK get commitments", False, f"Missing fields: {data}")
            return
        
        # Find our commitment
        found = any(c.get("commitment_id") == commitment_id for c in data["commitments"])
        if not found:
            log_result("ZK get commitments", False, f"Commitment {commitment_id} not found")
            return
        
        log_result("ZK get commitments", True)
        print(f"  - Total commitments: {data['count']}")
    except Exception as e:
        log_result("ZK get commitments", False, str(e))

def test_zk_verify_valid(token):
    """Test verifying ZK commitment with correct values"""
    try:
        # Create commitment
        amount_wei = "5000000000000000000"  # 5 ETH
        blinding_factor = secrets.token_hex(32)
        commitment_hash = create_commitment_hash(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "polygon"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        commitment_id = create_response.json()["commitment_id"]
        
        # Verify with correct values
        verify_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": blinding_factor
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if verify_response.status_code != 200:
            log_result("ZK verify valid commitment", False, f"Status: {verify_response.status_code}")
            return
        
        data = verify_response.json()
        if data.get("is_valid") != True:
            log_result("ZK verify valid commitment", False, f"is_valid should be True: {data}")
            return
        
        if data.get("recomputed_hash") != data.get("stored_hash"):
            log_result("ZK verify valid commitment", False, "Hashes don't match")
            return
        
        log_result("ZK verify valid commitment", True)
    except Exception as e:
        log_result("ZK verify valid commitment", False, str(e))

def test_zk_verify_invalid(token):
    """Test verifying ZK commitment with wrong values"""
    try:
        # Create commitment
        amount_wei = "3000000000000000000"
        blinding_factor = secrets.token_hex(32)
        commitment_hash = create_commitment_hash(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "optimism"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        commitment_id = create_response.json()["commitment_id"]
        
        # Verify with WRONG blinding factor
        verify_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": "wrong_blinding_factor"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if verify_response.status_code != 200:
            log_result("ZK verify invalid commitment", False, f"Status: {verify_response.status_code}")
            return
        
        data = verify_response.json()
        if data.get("is_valid") != False:
            log_result("ZK verify invalid commitment", False, f"is_valid should be False: {data}")
            return
        
        log_result("ZK verify invalid commitment", True)
    except Exception as e:
        log_result("ZK verify invalid commitment", False, str(e))

def test_zk_verify_nonexistent(token):
    """Test verifying non-existent commitment returns 404"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": "nonexistent-id-12345",
                "amount_wei": "1000000000000000000",
                "blinding_factor": "test"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        passed = response.status_code == 404
        log_result("ZK verify nonexistent returns 404", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("ZK verify nonexistent returns 404", False, str(e))


# ============== ENCRYPTED RECEIPTS TESTS ==============

def test_receipt_create(token):
    """Test creating encrypted receipt"""
    try:
        receipt_data = {
            "transaction_hash": "0x" + secrets.token_hex(32),
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "1000000000000000000",
            "chain": "base",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code != 200:
            log_result("Receipt create", False, f"Status: {response.status_code}, Response: {response.text}")
            return None
        
        data = response.json()
        required = ["receipt_id", "encrypted_data", "one_time_code", "created_at"]
        missing = [f for f in required if f not in data]
        
        if missing:
            log_result("Receipt create", False, f"Missing fields: {missing}")
            return None
        
        # Verify one_time_code is 32 hex chars (16 bytes)
        if len(data["one_time_code"]) != 32:
            log_result("Receipt create", False, f"Invalid one_time_code length: {len(data['one_time_code'])}")
            return None
        
        log_result("Receipt create", True)
        return data
    except Exception as e:
        log_result("Receipt create", False, str(e))
        return None

def test_receipt_create_and_decrypt(token):
    """Test full cycle: create and decrypt receipt"""
    try:
        tx_hash = "0x" + secrets.token_hex(32)
        receipt_data = {
            "transaction_hash": tx_hash,
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "2500000000000000000",
            "chain": "arbitrum",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Create receipt
        create_response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if create_response.status_code != 200:
            log_result("Receipt create and decrypt", False, f"Create failed: {create_response.text}")
            return
        
        created = create_response.json()
        receipt_id = created["receipt_id"]
        one_time_code = created["one_time_code"]
        
        # Decrypt receipt
        decrypt_response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": receipt_id,
                "one_time_code": one_time_code
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if decrypt_response.status_code != 200:
            log_result("Receipt create and decrypt", False, f"Decrypt failed: {decrypt_response.text}")
            return
        
        data = decrypt_response.json()
        if "receipt" not in data:
            log_result("Receipt create and decrypt", False, f"No receipt in response: {data}")
            return
        
        decrypted = data["receipt"]
        
        # Verify decrypted data matches original
        if decrypted.get("transaction_hash") != tx_hash:
            log_result("Receipt create and decrypt", False, f"TX hash mismatch")
            return
        
        if decrypted.get("sender") != receipt_data["sender_address"]:
            log_result("Receipt create and decrypt", False, f"Sender mismatch")
            return
        
        if decrypted.get("amount_wei") != receipt_data["amount_wei"]:
            log_result("Receipt create and decrypt", False, f"Amount mismatch")
            return
        
        log_result("Receipt create and decrypt", True)
    except Exception as e:
        log_result("Receipt create and decrypt", False, str(e))

def test_receipt_decrypt_wrong_code(token):
    """Test decrypting with wrong code fails"""
    try:
        receipt_data = {
            "transaction_hash": "0x" + secrets.token_hex(32),
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "1000000000000000000",
            "chain": "polygon",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        receipt_id = create_response.json()["receipt_id"]
        
        # Try to decrypt with wrong code
        decrypt_response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": receipt_id,
                "one_time_code": "wrong_code_here"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = decrypt_response.status_code == 401
        log_result("Receipt decrypt wrong code rejected", passed, "" if passed else f"Status: {decrypt_response.status_code}")
    except Exception as e:
        log_result("Receipt decrypt wrong code rejected", False, str(e))

def test_receipt_decrypt_nonexistent(token):
    """Test decrypting non-existent receipt returns 404"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": "nonexistent-receipt-id",
                "one_time_code": "some_code"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        passed = response.status_code == 404
        log_result("Receipt decrypt nonexistent returns 404", passed, "" if passed else f"Status: {response.status_code}")
    except Exception as e:
        log_result("Receipt decrypt nonexistent returns 404", False, str(e))


# ============== AUTH REQUIRED TESTS ==============

def test_endpoints_require_auth():
    """Test that protected endpoints require auth"""
    endpoints_to_test = [
        ("POST", f"{BASE_URL}/api/addressbook/add", {"owner_address": TEST_OWNER_ADDRESS, "label": "test"}),
        ("GET", f"{BASE_URL}/api/addressbook/{TEST_OWNER_ADDRESS}", None),
        ("POST", f"{BASE_URL}/api/zk-commitments/create", {"owner_address": TEST_OWNER_ADDRESS, "commitment_hash": "test", "amount_range": "1-10 ETH"}),
        ("GET", f"{BASE_URL}/api/zk-commitments/{TEST_OWNER_ADDRESS}", None),
        ("POST", f"{BASE_URL}/api/receipt/create", {"transaction_hash": "0x123", "sender_address": TEST_OWNER_ADDRESS, "recipient_stealth_address": "0x456", "amount_wei": "1000", "chain": "base", "timestamp": "2024-01-01T00:00:00Z"}),
        ("POST", f"{BASE_URL}/api/receipt/decrypt", {"receipt_id": "test", "one_time_code": "test"}),
    ]
    
    all_passed = True
    for method, url, body in endpoints_to_test:
        try:
            if method == "GET":
                response = requests.get(url)
            else:
                response = requests.post(url, json=body)
            
            if response.status_code != 401:
                all_passed = False
                print(f"  - {method} {url.split('/api/')[-1]}: Expected 401, got {response.status_code}")
        except Exception as e:
            all_passed = False
            print(f"  - {method} {url.split('/api/')[-1]}: Error - {e}")
    
    log_result("Protected endpoints require auth", all_passed)


# ============== MAIN ==============

def main():
    print("=" * 60)
    print("Universal Privacy Layer - Backend API Tests")
    print(f"Base URL: {BASE_URL}")
    print("=" * 60)
    print()
    
    # Basic tests
    print("--- Basic Tests ---")
    test_health()
    test_auth_valid()
    test_auth_invalid()
    print()
    
    # Get auth token for protected tests
    token = get_auth_token()
    if not token:
        print("FATAL: Could not get auth token. Aborting tests.")
        sys.exit(1)
    
    print(f"Auth token obtained successfully")
    print()
    
    # Wallet Privacy Analyzer tests
    print("--- Wallet Privacy Analyzer Tests ---")
    test_analyzer_scan(token)
    test_analyzer_chain_data(token)
    test_analyzer_without_auth()
    print()
    
    # Address Book tests
    print("--- Privacy Address Book Tests ---")
    test_addressbook_add(token)
    test_addressbook_get(token)
    test_addressbook_delete(token)
    test_addressbook_delete_nonexistent(token)
    print()
    
    # ZK Commitments tests
    print("--- ZK Commitments Tests ---")
    test_zk_create_commitment(token)
    test_zk_get_commitments(token)
    test_zk_verify_valid(token)
    test_zk_verify_invalid(token)
    test_zk_verify_nonexistent(token)
    print()
    
    # Encrypted Receipts tests
    print("--- Encrypted Receipts Tests ---")
    test_receipt_create(token)
    test_receipt_create_and_decrypt(token)
    test_receipt_decrypt_wrong_code(token)
    test_receipt_decrypt_nonexistent(token)
    print()
    
    # Auth required tests
    print("--- Auth Required Tests ---")
    test_endpoints_require_auth()
    print()
    
    # Summary
    print("=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    total = results["passed"] + results["failed"]
    print(f"Passed: {results['passed']}/{total}")
    print(f"Failed: {results['failed']}/{total}")
    print(f"Success Rate: {(results['passed']/total*100):.1f}%")
    print()
    
    if results["failed"] > 0:
        print("Failed Tests:")
        for test in results["tests"]:
            if not test["passed"]:
                print(f"  - {test['name']}: {test['message']}")
    
    # Save results to JSON
    with open("/app/test_reports/pytest/test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\nResults saved to /app/test_reports/pytest/test_results.json")
    
    return 0 if results["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
